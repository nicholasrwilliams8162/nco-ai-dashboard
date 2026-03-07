import Groq from 'groq-sdk';
import { v4 as uuidv4 } from 'uuid';
import { createRecord, updateRecord, getRecord } from './restRecordClient.js';
import { runSuiteQL } from './netsuiteClient.js';
import db from '../db/database.js';

// Short-lived in-memory store for pending plans (5 min TTL)
const pendingPlans = new Map();

// Tools implemented directly via the NetSuite REST Record API.
// No MCP SuiteApp required.
const AGENT_TOOLS = [
  {
    name: 'createRecord',
    description: 'Create a new NetSuite record of any type.',
    params: '{ recordType: string, values: object }',
    examples: 'recordType: "customer", "vendor", "salesorder", "purchaseorder", "contact", "employee"',
  },
  {
    name: 'updateRecord',
    description: 'Update fields on an existing NetSuite record by internal ID.',
    params: '{ recordType: string, id: string|number, values: object }',
  },
  {
    name: 'getRecord',
    description: 'Retrieve a NetSuite record by type and internal ID.',
    params: '{ recordType: string, id: string|number, fields?: string[] }',
  },
  {
    name: 'runSuiteQL',
    description: 'Execute a SuiteQL query to search for or aggregate data.',
    params: '{ query: string }',
  },
];

const FIELD_HINTS = `
Common NetSuite REST field names:
- customer (company): isperson=false, companyname (required), email, phone, subsidiary (id), salesrep (id), terms (id), creditlimit
- customer (individual): isperson=true, firstname (required), lastname (required), email, phone
  IMPORTANT: when isperson=true you MUST provide firstname and lastname — do NOT use companyname.
  When isperson=false you MUST provide companyname — do NOT use firstname/lastname.
  Default to isperson=false (company) unless the instruction clearly refers to an individual person.
- vendor: companyname, email, phone, subsidiary (id), terms (id)
- contact: firstname, lastname, email, phone, company (id)
- salesorder: entity (customer id), trandate ("YYYY-MM-DD"), memo, department (id), location (id)
- employee: firstname, lastname, email, phone, department (id), subsidiary (id), title

For reference fields (subsidiary, entity, salesrep, etc.) pass { "id": "123" } as the value.
Booleans are JSON true/false (NOT "T"/"F" — the REST API requires actual booleans).
`;

function getGroqClient() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'groq_api_key'").get();
  const apiKey = row?.value || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq API key is not configured. Add it in Settings.');
  return new Groq({ apiKey });
}

function cleanPendingPlans() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, plan] of pendingPlans) {
    if (plan.createdAt < cutoff) pendingPlans.delete(id);
  }
}

function buildSystemPrompt() {
  const toolList = AGENT_TOOLS
    .map(t => `- ${t.name}(${t.params}): ${t.description}${t.examples ? ` e.g. ${t.examples}` : ''}`)
    .join('\n');

  return `You are a NetSuite operations agent. The user gives you instructions to perform actions in NetSuite.

Available tools (via NetSuite REST Record API):
${toolList}

${FIELD_HINTS}

IMPORTANT — respond with one of two JSON shapes:

1. If you need clarification before you can act (ambiguous name, missing required field, unclear intent):
{
  "action": "clarify",
  "question": "Your specific, helpful question. Suggest the most likely answer so the user can confirm or correct. e.g. 'Should I use Gerald as the first name and Aucoin as the last name, or would you like to use a different name?'"
}

2. If you have all the information needed:
{
  "action": "execute",
  "tool": "toolName",
  "arguments": { ... },
  "confirmation": "One sentence describing exactly what you will do",
  "isWrite": true,
  "riskLevel": "low"
}

Rules for clarifying:
- Ask when: a name could be a person or company, a required field is missing, an ID is needed but not provided
- Ask ONE focused question at a time
- Always suggest the most likely answer in the question so the user can confirm quickly

Rules for executing:
- "isWrite": true if creating/modifying data, false for reads
- "riskLevel": "low" (reads, contacts), "medium" (customers, orders, field updates), "high" (financial records, bulk changes)
- For createRecord, put field values in "arguments.values"
- Today's date: ${new Date().toISOString().split('T')[0]}`;
}

// clarifications: [{ question: string, answer: string }, ...]
export async function planAgentAction(instruction, clarifications = []) {
  cleanPendingPlans();

  const client = getGroqClient();
  const systemPrompt = buildSystemPrompt();

  // Build the conversation: original instruction + any clarification Q&A
  const messages = [{ role: 'user', content: instruction }];
  for (const { question, answer } of clarifications) {
    messages.push({ role: 'assistant', content: JSON.stringify({ action: 'clarify', question }) });
    messages.push({ role: 'user', content: answer });
  }

  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const plan = JSON.parse(response.choices[0].message.content);

  // Model wants to ask a clarifying question
  if (plan.action === 'clarify') {
    return { status: 'clarify', question: plan.question };
  }

  // Model couldn't handle it
  if (!plan.tool) {
    return {
      status: 'error',
      message: plan.confirmation || 'I could not determine how to handle that instruction.',
    };
  }

  const planId = uuidv4();
  pendingPlans.set(planId, { ...plan, instruction, createdAt: Date.now() });

  return {
    status: 'ready',
    planId,
    tool: plan.tool,
    arguments: plan.arguments,
    confirmation: plan.confirmation,
    isWrite: plan.isWrite ?? true,
    riskLevel: plan.riskLevel || 'medium',
  };
}

export async function executeAgentPlan(planId) {
  const plan = pendingPlans.get(planId);
  if (!plan) throw new Error('Plan not found or expired. Please try again.');
  pendingPlans.delete(planId);

  const { tool, arguments: args } = plan;
  console.log(`[Agent] Executing: ${tool}`, args);

  let result;

  switch (tool) {
    case 'createRecord':
      result = await createRecord(args.recordType, args.values);
      break;
    case 'updateRecord':
      result = await updateRecord(args.recordType, args.id, args.values);
      break;
    case 'getRecord':
      result = await getRecord(args.recordType, args.id, args.fields);
      break;
    case 'runSuiteQL': {
      const qResult = await runSuiteQL(args.query);
      result = {
        text: `Query returned ${qResult.totalResults} row(s).\n${JSON.stringify(qResult.items, null, 2)}`,
      };
      break;
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }

  db.prepare(`
    INSERT INTO agent_history (instruction, tool, arguments, result, success, record_type, record_id, before_state, status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'success')
  `).run(
    plan.instruction,
    tool,
    JSON.stringify(args),
    result.text,
    result.recordType || null,
    result.id || null,
    result.beforeState ? JSON.stringify(result.beforeState) : null,
  );

  return { success: true, result: result.text, tool };
}
