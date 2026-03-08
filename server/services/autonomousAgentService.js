import Groq from 'groq-sdk';
import { buildSchemaContext } from './schemaContext.js';
import { runSuiteQL } from './netsuiteClient.js';
import { createRecord, updateRecord } from './restRecordClient.js';
import db from '../db/database.js';

function getGroqClient(userId) {
  const row = userId
    ? db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'groq_api_key'").get(userId)
    : db.prepare("SELECT value FROM app_settings WHERE key = 'groq_api_key'").get();
  const apiKey = row?.value || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq API key is not configured. Add it in Settings.');
  return new Groq({ apiKey });
}

// Replace {{column_name}} placeholders with values from a query result row
function fillTemplate(template, row) {
  if (typeof template === 'string') {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = row[key] ?? row[key.toLowerCase()] ?? '';
      return String(val);
    });
  }
  if (Array.isArray(template)) {
    return template.map(v => fillTemplate(v, row));
  }
  if (template && typeof template === 'object') {
    return Object.fromEntries(
      Object.entries(template).map(([k, v]) => [k, fillTemplate(v, row)])
    );
  }
  return template;
}

function addNotification(agentId, runId, type, message) {
  db.prepare(`
    INSERT INTO agent_notifications (agent_id, run_id, type, message)
    VALUES (?, ?, ?, ?)
  `).run(agentId, runId ?? null, type, message);
}

function buildPlannerPrompt(instructions) {
  return `You are a NetSuite automation planner. Given natural language instructions for a scheduled automation, produce a JSON execution plan.

${buildSchemaContext(instructions)}

Return ONLY this JSON structure (no extra keys):
{
  "query": "SuiteQL SELECT statement with explicit column aliases",
  "queryDescription": "What the query finds in plain English",
  "actionTool": "flag" | "updateRecord" | "createRecord",
  "actionArguments": {
    "recordType": "netsuite_record_type",
    "id": "{{column_alias_for_record_id}}",
    "values": { "field": "value" }
  },
  "notifyMessage": "Per-record summary using {{column_alias}} placeholders",
  "planSummary": "One sentence: what this automation does overall"
}

Rules:
- For actionTool "flag" (report-only, no writes): set actionArguments to null.
- For "updateRecord": the id field MUST be a {{column_alias}} referencing a numeric ID column from your SELECT. Include both the ID column (e.g. t.id AS txn_id, t.entity AS entity_id) and a display name column in the SELECT.
- For "createRecord": values are fixed constants.
- Always include t.id AS txn_id (or equivalent) in every SELECT so records can be identified.
- For notifyMessage and actionArguments: use {{exact_column_alias}} from your SELECT.
- CRITICAL: mainline is a column on transactionline, NOT on transaction. Never write t.mainline on the transaction table.
- Limit results with ROWNUM <= 200 (or less) to avoid overwhelming the system.

CRITICAL — REST API recordType names (use EXACTLY, all lowercase, no spaces):
  salesorder, invoice, vendorbill, purchaseorder, estimate, itemreceipt,
  itemfulfillment, journalentry, check, deposit, expensereport, cashsale,
  returnauthorization, inventoryadjustment, customer, vendor, contact, employee
  ✗ NEVER use display names like "Sales Order", "Vendor Bill", "Purchase Order"

Today: ${new Date().toISOString().split('T')[0]}`;
}

async function callGroq(client, systemPrompt, messages) {
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });
  return response.choices[0].message.content;
}

function getAgentMemories(agentId) {
  // Return at most 3 per type (approved, denied, correction) — deduplication by recency
  const rows = db.prepare(`
    SELECT type, summary FROM agent_memories
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(agentId);

  const counts = {};
  const deduped = [];
  for (const row of rows) {
    counts[row.type] = (counts[row.type] || 0) + 1;
    if (counts[row.type] <= 3) deduped.push(row);
    if (Object.values(counts).every(c => c >= 3)) break;
  }
  return deduped;
}

function saveMemory(agentId, type, summary) {
  db.prepare(`
    INSERT INTO agent_memories (agent_id, type, summary) VALUES (?, ?, ?)
  `).run(agentId, type, summary);
}

// Check if the cached plan is still valid (no new memories since it was cached)
function isCacheValid(agent) {
  if (!agent.cached_plan || !agent.plan_cached_at) return false;
  const newMemory = db.prepare(`
    SELECT 1 FROM agent_memories WHERE agent_id = ? AND created_at > ?
  `).get(agent.id, agent.plan_cached_at);
  return !newMemory;
}

// Plan the execution — uses cached plan if valid, otherwise calls Groq
async function planExecution(agent) {
  // Return cached plan without any Groq call
  if (isCacheValid(agent)) {
    console.log(`[AutoAgent] "${agent.name}" using cached plan (no Groq call)`);
    const plan = JSON.parse(agent.cached_plan);
    return { plan, rawText: agent.cached_plan, client: null, systemPrompt: null, userMessages: null, fromCache: true };
  }

  const client = getGroqClient(agent.user_id);

  const memories = getAgentMemories(agent.id);
  let memoryBlock = '';
  if (memories.length > 0) {
    const lines = memories.map(m => {
      const prefix = m.type === 'approved' ? 'Approved' : m.type === 'denied' ? 'Denied' : 'Correction';
      return `${prefix}: ${m.summary}`;
    }).join('\n');
    memoryBlock = `\nPAST LEARNING:\n${lines}`;
  }

  const systemPrompt = buildPlannerPrompt(agent.instructions) + memoryBlock;
  const userMessages = [{ role: 'user', content: agent.instructions }];

  const text = await callGroq(client, systemPrompt, userMessages);
  const plan = JSON.parse(text);

  // Cache the successful plan
  db.prepare(`
    UPDATE autonomous_agents SET cached_plan = ?, plan_cached_at = datetime('now') WHERE id = ?
  `).run(text, agent.id);

  return { plan, rawText: text, client, systemPrompt, userMessages, fromCache: false };
}

export async function executeAgent(agentId) {
  const agent = db.prepare('SELECT * FROM autonomous_agents WHERE id = ?').get(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Create run record
  const runResult = db.prepare(`
    INSERT INTO agent_runs (agent_id, status, started_at)
    VALUES (?, 'running', datetime('now'))
  `).run(agentId);
  const runId = runResult.lastInsertRowid;

  db.prepare(`UPDATE autonomous_agents SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(agentId);

  let plan = null;
  try {
    // Step 1: AI generates execution plan
    const { plan: initialPlan, rawText, client, systemPrompt, userMessages, fromCache } = await planExecution(agent);
    plan = initialPlan;
    console.log(`[AutoAgent] ${agent.name} plan:`, plan.planSummary);

    if (!plan.query) throw new Error('AI did not produce a SuiteQL query for this instruction.');

    // Step 2: Run the query — with one self-correction retry on failure
    let rows = [];
    console.log(`[AutoAgent] Query:\n${plan.query}`);
    try {
      const result = await runSuiteQL(plan.query, { userId: agent.user_id });
      rows = result.items || [];
    } catch (firstErr) {
      console.warn(`[AutoAgent] Query failed: ${firstErr.message}\nAttempting self-correction…`);
      const failedQuery = plan.query;

      // If we were on a cached plan, invalidate it first
      if (fromCache) {
        db.prepare(`UPDATE autonomous_agents SET cached_plan = NULL, plan_cached_at = NULL WHERE id = ?`).run(agentId);
      }

      try {
        // Need a live client for correction — get one if we were on cache
        const corrClient = client ?? getGroqClient(agent.user_id);
        const corrSystemPrompt = systemPrompt ?? (buildPlannerPrompt(agent.instructions));
        const corrUserMessages = userMessages ?? [{ role: 'user', content: agent.instructions }];

        const correctionMessages = [
          ...corrUserMessages,
          { role: 'assistant', content: rawText },
          {
            role: 'user',
            content: `Query failed: "${firstErr.message}".\nFailed query:\n${failedQuery}\nFix it and return the corrected JSON plan.`,
          },
        ];
        const correctedText = await callGroq(corrClient, corrSystemPrompt, correctionMessages);
        plan = JSON.parse(correctedText);
        if (!plan.query) throw new Error('Corrected plan has no query');
        console.log(`[AutoAgent] Corrected query:\n${plan.query}`);
        const result = await runSuiteQL(plan.query, { userId: agent.user_id });
        rows = result.items || [];
        console.log(`[AutoAgent] Self-correction succeeded`);
        // Cache the corrected plan and save memory
        db.prepare(`UPDATE autonomous_agents SET cached_plan = ?, plan_cached_at = datetime('now') WHERE id = ?`).run(correctedText, agentId);
        saveMemory(agentId, 'correction', `Query failed with "${firstErr.message}" — corrected by removing/fixing the offending field`);
      } catch (secondErr) {
        const errMsg = `${secondErr.message}\n\nLast query attempted:\n${plan.query ?? failedQuery}`;
        throw new Error(errMsg);
      }
    }

    console.log(`[AutoAgent] ${agent.name}: ${rows.length} record(s) found`);

    let actionsCreated = 0;

    // Step 3: Per-row action
    for (const row of rows) {
      const message = fillTemplate(plan.notifyMessage || plan.queryDescription, row);

      if (plan.actionTool === 'flag' || !plan.actionArguments) {
        // Flag only — just create a notification
        addNotification(agentId, runId, 'flag', message);
        actionsCreated++;
      } else if (agent.require_approval) {
        // Queue for user approval — skip if a pending todo already exists for this record
        const filledArgs = fillTemplate(plan.actionArguments, row);
        const recordId = String(filledArgs?.id ?? '');
        const alreadyPending = recordId && db.prepare(`
          SELECT 1 FROM agent_todos
          WHERE agent_id = ? AND record_id = ? AND action_tool = ? AND status = 'pending'
        `).get(agentId, recordId, plan.actionTool);

        if (alreadyPending) {
          console.log(`[AutoAgent] Skipping duplicate pending todo for record ${recordId}`);
        } else {
          db.prepare(`
            INSERT INTO agent_todos
              (agent_id, run_id, status, action_tool, description, arguments, record_id, record_type)
            VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
          `).run(
            agentId,
            runId,
            plan.actionTool,
            message,
            JSON.stringify(filledArgs),
            recordId,
            normalizeRecordType(filledArgs?.recordType) ?? null,
          );
          actionsCreated++;
        }
      } else {
        // Auto-execute
        try {
          const filledArgs = fillTemplate(plan.actionArguments, row);
          filledArgs.recordType = normalizeRecordType(filledArgs.recordType);
          if (plan.actionTool === 'updateRecord') {
            await updateRecord(filledArgs.recordType, filledArgs.id, filledArgs.values, agent.user_id);
          } else if (plan.actionTool === 'createRecord') {
            await createRecord(filledArgs.recordType, filledArgs.values, agent.user_id);
          }
          addNotification(agentId, runId, 'action', `Executed: ${message}`);
          actionsCreated++;
        } catch (err) {
          addNotification(agentId, runId, 'error', `Failed on record: ${message} — ${err.message}`);
        }
      }
    }

    // Finalize run
    db.prepare(`
      UPDATE agent_runs
      SET status = 'completed', completed_at = datetime('now'),
          records_found = ?, actions_created = ?, plan_summary = ?, query = ?
      WHERE id = ?
    `).run(rows.length, actionsCreated, plan.planSummary, plan.query ?? null, runId);

    // Progress notification if anything was found
    if (rows.length > 0) {
      const verb = agent.require_approval && plan.actionTool !== 'flag'
        ? 'queued for approval'
        : plan.actionTool === 'flag' ? 'flagged' : 'actioned';
      addNotification(agentId, runId, 'progress',
        `${plan.queryDescription}: ${rows.length} record(s) found, ${actionsCreated} ${verb}`);
    }

    return { runId, recordsFound: rows.length, actionsCreated };
  } catch (err) {
    db.prepare(`
      UPDATE agent_runs SET status = 'failed', completed_at = datetime('now'), error = ?, query = ? WHERE id = ?
    `).run(err.message, plan?.query ?? null, runId);
    addNotification(agentId, runId, 'error', `Agent "${agent.name}" failed: ${err.message}`);
    console.error(`[AutoAgent] ${agent.name} failed:`, err.message);
    throw err;
  }
}

const RECORD_TYPE_MAP = {
  'sales order': 'salesorder',
  'salesord':    'salesorder',
  'invoice':     'invoice',
  'custinvc':    'invoice',
  'vendor bill': 'vendorbill',
  'vendbill':    'vendorbill',
  'purchase order': 'purchaseorder',
  'purchord':    'purchaseorder',
  'estimate':    'estimate',
  'item receipt': 'itemreceipt',
  'itemrcpt':    'itemreceipt',
  'item fulfillment': 'itemfulfillment',
  'itemship':    'itemfulfillment',
  'journal entry': 'journalentry',
  'journal':     'journalentry',
  'cash sale':   'cashsale',
  'return authorization': 'returnauthorization',
  'rtnauth':     'returnauthorization',
  'expense report': 'expensereport',
  'exprept':     'expensereport',
  'inventory adjustment': 'inventoryadjustment',
  'invadjst':    'inventoryadjustment',
};

function normalizeRecordType(rt) {
  if (!rt) return rt;
  return RECORD_TYPE_MAP[rt.toLowerCase()] ?? rt.toLowerCase().replace(/\s+/g, '');
}

export async function executeTodo(todoId) {
  const todo = db.prepare('SELECT * FROM agent_todos WHERE id = ?').get(todoId);
  if (!todo) throw new Error('Todo not found');
  if (todo.status !== 'pending') throw new Error('This item has already been processed');

  const args = JSON.parse(todo.arguments);

  try {
    const agent = db.prepare('SELECT user_id FROM autonomous_agents WHERE id = ?').get(todo.agent_id);
  args.recordType = normalizeRecordType(args.recordType);
    if (todo.action_tool === 'updateRecord') {
      await updateRecord(args.recordType, args.id, args.values, agent?.user_id);
    } else if (todo.action_tool === 'createRecord') {
      await createRecord(args.recordType, args.values, agent?.user_id);
    } else {
      throw new Error(`Unknown action tool: ${todo.action_tool}`);
    }

    db.prepare(`UPDATE agent_todos SET status = 'approved', updated_at = datetime('now') WHERE id = ?`).run(todoId);
    addNotification(todo.agent_id, todo.run_id, 'action', `Approved & executed: ${todo.description}`);

    // Save approval memory
    saveMemory(todo.agent_id, 'approved',
      `Action "${todo.action_tool}" on ${args.recordType} was approved. Record: ${todo.description}`);

    return { success: true };
  } catch (err) {
    db.prepare(`UPDATE agent_todos SET status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(todoId);
    throw err;
  }
}

export function denyTodo(todoId, reason) {
  const todo = db.prepare('SELECT * FROM agent_todos WHERE id = ?').get(todoId);
  if (!todo) throw new Error('Todo not found');

  db.prepare(`
    UPDATE agent_todos SET status = 'denied', deny_reason = ?, updated_at = datetime('now') WHERE id = ?
  `).run(reason || null, todoId);

  // Save denial memory so future runs can avoid this pattern
  const memorySummary = reason
    ? `Action on record "${todo.description}" was denied. Reason: ${reason}`
    : `Action on record "${todo.description}" was denied by user`;
  saveMemory(todo.agent_id, 'denied', memorySummary);
}
