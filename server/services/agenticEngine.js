/**
 * agenticEngine.js — Unified agentic loop for NetSuite AI operations.
 *
 * Replaces aiService.js (widget queries) and agentService.js (agent writes).
 * All NetSuite calls go through mcpClient.js → NetSuite MCP endpoint.
 *
 * Widget queries:   processNaturalLanguageQuery(), refreshWidgetData()
 * Agent writes:     planAgentAction(), executeAgentPlan()
 */

import Groq from 'groq-sdk';
import { v4 as uuidv4 } from 'uuid';
import { buildSchemaContext } from './schemaContext.js';
import { runMcpSuiteQL, getMcpRecordTypeMetadata, callMcpTool, listMcpTools } from './mcpClient.js';
import { searchNetSuiteDocs } from './docSearchService.js';
import db from '../db/database.js';

// ─── Status filter enforcement ────────────────────────────────────────────────
// LLM consistently adds status filters even when not requested. Enforce in code.
const STATUS_REQUEST_KEYWORDS = /\b(open|unbilled|not billed|not closed|overdue|pending approval|past due)\b/i;

function enforceStatusFilterRule(query, userText) {
  if (!query || STATUS_REQUEST_KEYWORDS.test(userText || '')) return query;
  let cleaned = query;
  cleaned = cleaned.replace(/\s*AND\s+BUILTIN\.DF\(\w+\.status\)\s+(?:NOT\s+)?LIKE\s+'[^']*'/gi, '');
  cleaned = cleaned.replace(/BUILTIN\.DF\(\w+\.status\)\s+(?:NOT\s+)?LIKE\s+'[^']*'\s*AND\s*/gi, '');
  cleaned = cleaned.replace(/BUILTIN\.DF\(\w+\.status\)\s+(?:NOT\s+)?LIKE\s+'[^']*'/gi, '');
  cleaned = cleaned.replace(/\bWHERE\s+AND\b/gi, 'WHERE');
  cleaned = cleaned.replace(/\bAND\s+ORDER\b/gi, 'ORDER');
  cleaned = cleaned.replace(/\bWHERE\s+ORDER\b/gi, 'ORDER');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  if (cleaned !== query) console.log('[Engine] Stripped unsolicited status filter from query');
  return cleaned;
}

// ─── Groq client ──────────────────────────────────────────────────────────────

function getGroqClient(userId) {
  const row = userId
    ? db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'groq_api_key'").get(userId)
    : db.prepare("SELECT value FROM app_settings WHERE key = 'groq_api_key'").get();
  const apiKey = row?.value || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq API key is not configured. Add it in Settings.');
  return new Groq({ apiKey });
}

async function callGroq(client, systemPrompt, messages, maxTokens = 4000) {
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  });
  return response.choices[0].message.content;
}

function parseJson(text) {
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  if (start === -1) throw new Error('No JSON found in AI response');
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1));
    }
  }
  throw new Error('Malformed JSON in AI response');
}

// ─── Pending plans (agent write two-phase) ───────────────────────────────────

const pendingPlans = new Map();

function cleanPendingPlans() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, plan] of pendingPlans) {
    if (plan.createdAt < cutoff) pendingPlans.delete(id);
  }
}

// ─── System prompts ───────────────────────────────────────────────────────────

function buildWidgetSystemPrompt(userQuestion) {
  return `You are a NetSuite data analyst. To answer the user's question you call tools in sequence.
Respond with EXACTLY ONE JSON object per turn — no extra text.

AVAILABLE TOOLS:
{ "action": "runSuiteQL", "query": "SELECT ..." }
{ "action": "getRecordTypeMetadata", "recordType": "transaction" }
{ "action": "searchDocs", "keywords": "suiteql foreigntotal field" }
{ "action": "finalAnswer", "interpretation": "plain English summary", "query": "the successful SELECT ...", "visualization": { "type": "bar"|"line"|"pie"|"table"|"kpi", "title": "...", "xAxis": "col", "yAxis": "col", "valueColumn": "col", "labelColumn": "col", "description": "..." }, "suggestedRefreshInterval": 300 }

${buildSchemaContext(userQuestion)}

RULES:
- Always call runSuiteQL first. Never skip straight to finalAnswer without executing a query.
- If runSuiteQL fails, use getRecordTypeMetadata to verify actual field names on the relevant record type, then retry with a corrected query.
- Use searchDocs only if getRecordTypeMetadata is unavailable or the syntax question is about SuiteQL itself.
- NEVER retry the exact same query that already failed with the same error.
- When runSuiteQL returns 0 rows AND your query filtered on a specific transaction type (e.g. type = 'CustInvc'), try a DIFFERENT type before giving up. For revenue/sales queries: try SalesOrd, then CashSale, then remove the type filter entirely to see what data exists.
- When runSuiteQL succeeds with > 0 rows, call finalAnswer immediately — include the successful query string in the "query" field.
- finalAnswer.query MUST be the query that produced the result (copy it exactly).

TRANSACTION TYPE GUIDANCE (for revenue/sales queries):
- Not all NetSuite accounts use invoices (CustInvc). Many accounts book revenue via SalesOrd (sales orders).
- If CustInvc returns 0 rows, try SalesOrd next. Use foreigntotal for amounts.
- SalesOrd "open" status: BUILTIN.DF(status) NOT LIKE '%Billed%' AND BUILTIN.DF(status) NOT LIKE '%Closed%' (LIKE '%Open%' matches nothing)
- For "revenue this year/month": GROUP BY trandate or TRUNC(trandate, 'MONTH'), SUM(foreigntotal) AS revenue

VISUALIZATION:
- bar: comparisons across categories
- line: trends over time (xAxis = date/period column)
- pie: part-to-whole with ≤ 8 slices
- table: multi-column detail, no obvious chart story
- kpi: single number (valueColumn = the numeric column)

ROW LIMITS:
- Simple (no GROUP BY): WHERE ROWNUM <= 500
- Top-N with GROUP BY: SELECT * FROM (...GROUP BY...ORDER BY...) WHERE ROWNUM <= N
- Never put ROWNUM after ORDER BY at the same query level

Today: ${new Date().toISOString().split('T')[0]}`;
}

async function buildAgentSystemPrompt(userId) {
  // Fetch real tool list from NetSuite so descriptions are accurate
  let toolBlock = '';
  try {
    const tools = await listMcpTools(false, userId);
    if (tools.length) {
      toolBlock = tools.map(t => {
        const params = t.inputSchema?.properties
          ? Object.entries(t.inputSchema.properties)
              .map(([k, v]) => `${k}: ${v.type || 'any'}${v.description ? ' — ' + v.description : ''}`)
              .join(', ')
          : '';
        return `- ${t.name}: ${t.description || ''}${params ? `\n  Params: { ${params} }` : ''}`;
      }).join('\n');
    }
  } catch {
    // Fall back to known tools if MCP is unreachable
    toolBlock = `- runSuiteQL: Execute a SuiteQL query. Params: { query: string }
- ns_createRecord: Create a new NetSuite record. Params: { recordType: string, values: object }
- ns_updateRecord: Update an existing record. Params: { recordType: string, id: string, values: object }
- ns_getRecord: Retrieve a record by ID. Params: { recordType: string, id: string, fields?: string[] }
- ns_getRecordTypeMetadata: Get field definitions for a record type. Params: { recordType: string }`;
  }

  return `You are a NetSuite operations agent.
Respond with EXACTLY ONE JSON object per turn — no extra text.

AVAILABLE MCP TOOLS:
${toolBlock}

ADDITIONAL ACTIONS:
{ "action": "clarify", "question": "Your focused question. Suggest the most likely answer." }
{ "action": "finalAnswer", "tool": "ns_createRecord", "arguments": { ... }, "confirmation": "One sentence describing what will happen", "isWrite": true, "riskLevel": "medium" }

RULES:
- Call ns_getRecordTypeMetadata BEFORE ns_createRecord or ns_updateRecord if unsure of field names.
- Call ns_getRecord or runSuiteQL to look up an ID before writing if the instruction doesn't include one.
- Use "clarify" only when a required piece of information is genuinely missing.
- "isWrite": true for creates/updates, false for reads and queries.
- "riskLevel": "low" (reads, contacts) | "medium" (customers, orders, field updates) | "high" (financial records, bulk changes).
- Record type names are ALL LOWERCASE NO SPACES: salesorder, invoice, vendorbill, purchaseorder, customer, vendor, contact, employee, estimate, itemreceipt, itemfulfillment, journalentry.
- Booleans in REST API: JSON true/false (NOT "T"/"F").
- Reference fields: { "id": "123" }
- Today: ${new Date().toISOString().split('T')[0]}`;
}

// ─── Core agentic loop ────────────────────────────────────────────────────────

/**
 * Run the agentic loop for a given intent.
 *
 * @param {'widget_query'|'agent_write'} intent
 * @param {string} systemPrompt
 * @param {Array} initialMessages  — first user message(s)
 * @param {string|null} userId
 * @param {number} maxIterations
 * @returns {object} finalAnswer payload
 */
async function runAgenticLoop(intent, systemPrompt, initialMessages, userId, maxIterations, userText = '') {
  const client = getGroqClient(userId);
  const messages = [...initialMessages];
  let toolCallCount = 0;
  let lastQueryResult = null;

  // Count how many times each action has appeared to detect loops
  const actionCounts = {};

  while (toolCallCount < maxIterations) {
    const rawText = await callGroq(client, systemPrompt, messages);
    let step;
    try {
      step = parseJson(rawText);
    } catch {
      throw new Error(`Groq returned unparseable JSON: ${rawText?.slice(0, 200)}`);
    }

    const action = step.action;
    actionCounts[action] = (actionCounts[action] || 0) + 1;

    // ── finalAnswer ─────────────────────────────────────────────────────────
    if (action === 'finalAnswer') {
      // Guard: widget_query must have executed at least one query
      if (intent === 'widget_query' && !lastQueryResult) {
        messages.push({ role: 'assistant', content: rawText });
        messages.push({
          role: 'user',
          content: 'You must call runSuiteQL before finalAnswer. Please generate and execute a SuiteQL query now.',
        });
        toolCallCount++;
        continue;
      }
      return { step, lastQueryResult };
    }

    // ── clarify (agent_write only) ───────────────────────────────────────────
    if (action === 'clarify') {
      return { step, lastQueryResult };
    }

    // ── loop guard ──────────────────────────────────────────────────────────
    if (actionCounts[action] >= 3) {
      // Force final answer on next turn
      messages.push({ role: 'assistant', content: rawText });
      messages.push({
        role: 'user',
        content: `You have called "${action}" ${actionCounts[action]} times. You MUST now return a finalAnswer${intent === 'widget_query' ? ' with the best query result you have' : ''}.`,
      });
      const forceText = await callGroq(client, systemPrompt, messages);
      return { step: parseJson(forceText), lastQueryResult };
    }

    // ── execute tool ─────────────────────────────────────────────────────────
    let toolResultText = '';

    if (action === 'runSuiteQL') {
      try {
        step.query = enforceStatusFilterRule(step.query, userText);
        lastQueryResult = await runMcpSuiteQL(step.query, userId);
        if (lastQueryResult.totalResults === 0) {
          // Give Groq a hint to try alternate approaches instead of giving up
          const queryUpper = (step.query || '').toUpperCase();
          let zeroHint = '';
          if (queryUpper.includes("'CUSTINVC'") || queryUpper.includes("TYPE = 'CUSTINVC'")) {
            zeroHint = ' HINT: CustInvc returned 0 rows — this account likely uses SalesOrd for revenue. Retry with type = \'SalesOrd\'.';
          } else if (queryUpper.includes("TYPE =") || queryUpper.includes("TYPE='")) {
            zeroHint = ' HINT: 0 rows with type filter — try removing the type filter or using a different transaction type (SalesOrd, CashSale, CustInvc).';
          }
          toolResultText = `[Tool: runSuiteQL — SUCCESS]\nReturned 0 row(s).${zeroHint}`;
          lastQueryResult = null; // Don't treat 0 rows as a usable result
        } else {
          toolResultText = `[Tool: runSuiteQL — SUCCESS]\nReturned ${lastQueryResult.totalResults} row(s).\nFirst rows: ${JSON.stringify(lastQueryResult.items.slice(0, 3))}`;
        }
      } catch (err) {
        toolResultText = `[Tool: runSuiteQL — ERROR]\n${err.message}`;
        lastQueryResult = null;
      }

    } else if (action === 'getRecordTypeMetadata') {
      try {
        const meta = await getMcpRecordTypeMetadata(step.recordType, userId);
        toolResultText = `[Tool: getRecordTypeMetadata — SUCCESS]\n${meta}`;
      } catch (err) {
        toolResultText = `[Tool: getRecordTypeMetadata — ERROR]\n${err.message}`;
      }

    } else if (action === 'searchDocs') {
      const snippets = await searchNetSuiteDocs(step.keywords || step.query || '');
      toolResultText = snippets
        ? `[Tool: searchDocs — SUCCESS]\n${snippets}`
        : '[Tool: searchDocs — no relevant results found]';

    } else if (action === 'callTool' || (action && action !== 'finalAnswer' && action !== 'clarify')) {
      // Agent write: Groq calls an MCP tool directly (e.g. ns_getRecord)
      const toolName = action === 'callTool' ? step.toolName : action;
      const toolArgs = action === 'callTool' ? step.arguments : step.arguments || step;
      try {
        const mcpResult = await callMcpTool(toolName, toolArgs, userId);
        toolResultText = `[Tool: ${toolName} — ${mcpResult.isError ? 'ERROR' : 'SUCCESS'}]\n${mcpResult.text}`;
      } catch (err) {
        toolResultText = `[Tool: ${toolName} — ERROR]\n${err.message}`;
      }

    } else {
      toolResultText = `[Unknown action: ${action}]`;
    }

    messages.push({ role: 'assistant', content: rawText });
    messages.push({ role: 'user', content: toolResultText });
    toolCallCount++;
  }

  // Hit iteration cap — force a final answer
  messages.push({
    role: 'user',
    content: `You have reached the tool call limit (${maxIterations}). You MUST return a finalAnswer now${lastQueryResult ? ' using the last successful query result' : ''}.`,
  });
  const finalText = await callGroq(client, systemPrompt, messages);
  return { step: parseJson(finalText), lastQueryResult };
}

// ─── Widget query API (replaces aiService.js) ─────────────────────────────────

export async function processNaturalLanguageQuery(userQuestion, userId) {
  const systemPrompt = buildWidgetSystemPrompt(userQuestion);
  const initialMessages = [{ role: 'user', content: userQuestion }];

  const { step, lastQueryResult } = await runAgenticLoop(
    'widget_query',
    systemPrompt,
    initialMessages,
    userId,
    5, // max 5 tool calls — allows one retry when CustInvc returns 0 rows
    userQuestion,
  );

  if (step.action === 'finalAnswer') {
    if (!lastQueryResult) {
      return { success: false, interpretation: step.interpretation || 'Could not generate a valid query.', data: null, visualization: null };
    }
    return {
      success: true,
      interpretation: step.interpretation,
      query: step.query,
      data: lastQueryResult.items,
      totalResults: lastQueryResult.totalResults,
      visualization: step.visualization,
      suggestedRefreshInterval: step.suggestedRefreshInterval || 300,
    };
  }

  // If loop ended without a finalAnswer somehow
  return { success: false, interpretation: 'Could not produce an answer.', data: null, visualization: null };
}

export async function refreshWidgetData(savedQuery, userId) {
  // Fast path — no agentic loop needed, query is already known-good
  const result = await runMcpSuiteQL(savedQuery, userId);
  return {
    data: result.items,
    totalResults: result.totalResults,
    refreshedAt: new Date().toISOString(),
  };
}

// ─── Agent write API (replaces agentService.js) ───────────────────────────────

export async function planAgentAction(instruction, clarifications = [], userId) {
  cleanPendingPlans();

  const systemPrompt = await buildAgentSystemPrompt(userId);

  // Build conversation: original instruction + any clarification Q&A
  const messages = [{ role: 'user', content: instruction }];
  for (const { question, answer } of clarifications) {
    messages.push({ role: 'assistant', content: JSON.stringify({ action: 'clarify', question }) });
    messages.push({ role: 'user', content: answer });
  }

  const { step } = await runAgenticLoop(
    'agent_write',
    systemPrompt,
    messages,
    userId,
    5, // max 5 tool calls for agent writes
    instruction,
  );

  if (step.action === 'clarify') {
    return { status: 'clarify', question: step.question };
  }

  if (step.action !== 'finalAnswer' || !step.tool) {
    return {
      status: 'error',
      message: step.confirmation || step.interpretation || 'Could not determine how to handle that instruction.',
    };
  }

  const planId = uuidv4();
  pendingPlans.set(planId, {
    tool: step.tool,
    arguments: step.arguments,
    confirmation: step.confirmation,
    isWrite: step.isWrite ?? true,
    riskLevel: step.riskLevel || 'medium',
    instruction,
    userId,
    createdAt: Date.now(),
  });

  return {
    status: 'ready',
    planId,
    tool: step.tool,
    arguments: step.arguments,
    confirmation: step.confirmation,
    isWrite: step.isWrite ?? true,
    riskLevel: step.riskLevel || 'medium',
  };
}

/**
 * Extract record ID and type from an MCP tool result for history logging.
 */
function extractRecordIdFromMcpResult(toolName, mcpResult, planArgs) {
  try {
    const parsed = JSON.parse(mcpResult.text);
    if (toolName === 'ns_createRecord' || toolName === 'createRecord') {
      return {
        record_id: String(parsed.id || parsed.internalId || parsed.recordId || ''),
        record_type: planArgs?.recordType || null,
      };
    }
    if (toolName === 'ns_updateRecord' || toolName === 'updateRecord') {
      return {
        record_id: String(planArgs?.id || ''),
        record_type: planArgs?.recordType || null,
      };
    }
  } catch {
    // Non-fatal — fall back to args
  }
  return {
    record_id: String(planArgs?.id || ''),
    record_type: planArgs?.recordType || null,
  };
}

export async function executeAgentPlan(planId) {
  const plan = pendingPlans.get(planId);
  if (!plan) throw new Error('Plan not found or expired. Please try again.');
  pendingPlans.delete(planId);

  const { tool, arguments: args, userId } = plan;
  console.log(`[AgentEngine] Executing: ${tool}`, args);

  // For runSuiteQL via agent, call through MCP as well
  let mcpResult;
  if (tool === 'runSuiteQL') {
    const qResult = await runMcpSuiteQL(args.query, userId);
    const text = `Query returned ${qResult.totalResults} row(s).\n${JSON.stringify(qResult.items, null, 2)}`;
    db.prepare(`
      INSERT INTO agent_history (instruction, tool, arguments, result, success, record_type, record_id, before_state, status, user_id)
      VALUES (?, ?, ?, ?, 1, NULL, NULL, NULL, 'success', ?)
    `).run(plan.instruction, tool, JSON.stringify(args), text, userId || null);
    return { success: true, result: text, tool };
  }

  mcpResult = await callMcpTool(tool, args, userId);

  if (mcpResult.isError) {
    throw new Error(`NetSuite returned an error: ${mcpResult.text}`);
  }

  const { record_id, record_type } = extractRecordIdFromMcpResult(tool, mcpResult, args);

  db.prepare(`
    INSERT INTO agent_history (instruction, tool, arguments, result, success, record_type, record_id, before_state, status, user_id)
    VALUES (?, ?, ?, ?, 1, ?, ?, NULL, 'success', ?)
  `).run(
    plan.instruction,
    tool,
    JSON.stringify(args),
    mcpResult.text,
    record_type || null,
    record_id || null,
    userId || null,
  );

  return { success: true, result: mcpResult.text, tool };
}
