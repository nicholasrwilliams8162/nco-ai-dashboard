import { callAI } from './aiClient.js';
import { buildSchemaContext } from './schemaContext.js';
import { runMcpSuiteQL, callMcpTool } from './mcpClient.js';
import db from '../db/database.js';

// Runtime tokens that must be resolved at execution time, not at plan time
const RUNTIME_TOKENS = new Set(['NOW_UNIX', 'NOW_ISO', 'NOW_DATE']);

// Replace {{column_name}} placeholders with values from a query result row.
// Preserves {{RUNTIME_TOKEN}} placeholders so they can be resolved at execution time.
function fillTemplate(template, row) {
  if (typeof template === 'string') {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (RUNTIME_TOKENS.has(key)) return match; // preserve for execution-time resolution
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

// Resolve runtime tokens at the moment of execution (auto-execute or approval)
function resolveRuntimeTokens(template) {
  if (typeof template === 'string') {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key === 'NOW_UNIX') return Math.floor(Date.now() / 1000).toString();
      if (key === 'NOW_ISO')  return new Date().toISOString();
      if (key === 'NOW_DATE') return new Date().toISOString().split('T')[0];
      return match;
    });
  }
  if (Array.isArray(template)) return template.map(resolveRuntimeTokens);
  if (template && typeof template === 'object') {
    return Object.fromEntries(
      Object.entries(template).map(([k, v]) => [k, resolveRuntimeTokens(v)])
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
- STATUS FILTER RULE: Do NOT add any status filter (BUILTIN.DF(t.status) LIKE/NOT LIKE) unless the instruction explicitly contains the word "open", "unbilled", "not billed", or "pending". The word "sales orders", "invoices", "orders over $X", or similar alone does NOT justify a status filter — omit it entirely.
- SalesOrd open filter: use BUILTIN.DF(t.status) LIKE '%Pending%' — this matches all active statuses (Pending Approval, Pending Fulfillment, Pending Billing/Partially Fulfilled, Pending Billing). NEVER use NOT LIKE '%Billed%' — it wrongly excludes Pending Billing orders. NEVER use LIKE '%Open%' — matches nothing.
- Limit results with ROWNUM <= 200 (or less) to avoid overwhelming the system.

RUNTIME TOKENS — MANDATORY for any dynamic date/time value in actionArguments.values:
- {{NOW_DATE}} → resolves to today's date string at execution time, e.g. "2026-03-10"
- {{NOW_ISO}}  → resolves to full ISO datetime string at execution time, e.g. "2026-03-10T15:30:00.000Z"
- {{NOW_UNIX}} → resolves to Unix epoch integer as string at execution time, e.g. "1772930747"

CRITICAL RULES FOR TIMESTAMPS:
✗ NEVER write "SYSDATE", "SYSTIMESTAMP", "NOW()", or any SQL/SuiteQL function as a value — these are query-only and will be stored as a literal string "SYSDATE" in the record, which is WRONG.
✗ NEVER hardcode a date like "2026-03-10" — it will be stale on future runs.
✓ ALWAYS use {{NOW_DATE}} when the instruction says "current date", "today", or "timestamp as a string".
✓ ALWAYS use {{NOW_ISO}} when the instruction says "ISO timestamp" or "datetime string".
Example — if told to set field "otherrefnum" to current timestamp: "otherrefnum": "{{NOW_ISO}}"

CRITICAL — REST API recordType names (use EXACTLY, all lowercase, no spaces):
  salesorder, invoice, vendorbill, purchaseorder, estimate, itemreceipt,
  itemfulfillment, journalentry, check, deposit, expensereport, cashsale,
  returnauthorization, inventoryadjustment, customer, vendor, contact, employee
  ✗ NEVER use display names like "Sales Order", "Vendor Bill", "Purchase Order"

Today: ${new Date().toISOString().split('T')[0]}`;
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

// Keywords that legitimately justify a status filter in the WHERE clause
const STATUS_KEYWORDS = /\b(open|unbilled|not billed|not closed|overdue|pending approval|past due)\b/i;

/**
 * Post-process a Groq-generated SuiteQL query to strip status filters that
 * were not requested. The LLM has a strong bias toward adding status filters
 * even when instructions don't ask for them — this enforces the rule in code.
 *
 * Only removes BUILTIN.DF(x.status) LIKE/NOT LIKE conditions.
 * Leaves all other conditions untouched.
 */
function enforceStatusFilterRule(query, instructions) {
  if (STATUS_KEYWORDS.test(instructions)) return query; // user asked for filtered results — keep as-is

  // Strip BUILTIN.DF(...status...) [NOT] LIKE '...' fragments from the WHERE clause.
  // Handles AND on either side, multiple conditions, any alias.
  let cleaned = query;

  // Pattern: AND BUILTIN.DF(alias.status) [NOT] LIKE '...'
  //       or BUILTIN.DF(alias.status) [NOT] LIKE '...' AND
  //       or standalone
  cleaned = cleaned.replace(
    /\s*AND\s+BUILTIN\.DF\(\w+\.status\)\s+(?:NOT\s+)?LIKE\s+'[^']*'/gi,
    ''
  );
  // catch leading condition (if it was the first WHERE clause item)
  cleaned = cleaned.replace(
    /BUILTIN\.DF\(\w+\.status\)\s+(?:NOT\s+)?LIKE\s+'[^']*'\s*AND\s*/gi,
    ''
  );
  // catch orphaned standalone (no surrounding AND)
  cleaned = cleaned.replace(
    /BUILTIN\.DF\(\w+\.status\)\s+(?:NOT\s+)?LIKE\s+'[^']*'/gi,
    ''
  );

  // Clean up any double spaces or trailing AND/WHERE with nothing after it
  cleaned = cleaned.replace(/\bWHERE\s+AND\b/gi, 'WHERE');
  cleaned = cleaned.replace(/\bAND\s+ORDER\b/gi, 'ORDER');
  cleaned = cleaned.replace(/\bWHERE\s+ORDER\b/gi, 'ORDER');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  if (cleaned !== query) {
    console.log('[AutoAgent] Stripped unsolicited status filter from query');
  }
  return cleaned;
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

  const text = await callAI(systemPrompt, userMessages, agent.user_id);
  const plan = JSON.parse(text);

  // Deterministically enforce status filter rule (LLM often ignores prompt guidance)
  if (plan.query) {
    plan.query = enforceStatusFilterRule(plan.query, agent.instructions);
  }

  // Cache the successful plan (after enforcement so cache is also clean)
  const cachedText = JSON.stringify(plan);
  db.prepare(`
    UPDATE autonomous_agents SET cached_plan = ?, plan_cached_at = datetime('now') WHERE id = ?
  `).run(cachedText, agent.id);

  return { plan, rawText: cachedText, systemPrompt, userMessages, fromCache: false };
}

/**
 * Test an agent's SuiteQL query without creating todos or taking any action.
 * Supports iterative refinement via feedback + previousPlan.
 * Returns { plan, rows, totalResults } — no side effects.
 */
export async function testAgentQuery(instructions, userId, { feedback, previousPlan, agentId, customQuery } = {}) {
  let plan, query;

  if (customQuery) {
    // User provided SQL directly — skip Groq, just run the query
    query = customQuery.trim();
    plan = { ...(previousPlan || {}), query };
    if (agentId) {
      saveMemory(agentId, 'correction', `User manually edited the query to: "${query.slice(0, 120)}"`);
    }
  } else if (feedback && previousPlan) {
    // Refinement — send AI the previous plan + user feedback
    const systemPrompt = buildPlannerPrompt(instructions);
    const messages = [
      { role: 'user', content: instructions },
      { role: 'assistant', content: JSON.stringify(previousPlan) },
      {
        role: 'user',
        content: `The query ran but the results don't look right.\nUser feedback: "${feedback}"\nPlease fix the query and return a corrected JSON plan.`,
      },
    ];
    const rawText = await callAI(systemPrompt, messages, userId);
    plan = JSON.parse(rawText);
    query = plan.query;
    if (agentId) {
      saveMemory(agentId, 'correction', `User said results were wrong: "${feedback}". Query was corrected.`);
    }
  } else {
    // Fresh plan — always bypass cache during testing
    const tempAgent = { instructions, user_id: userId, cached_plan: null, plan_cached_at: null };
    const result = await planExecution(tempAgent);
    plan = result.plan;
    query = plan.query;
  }

  if (!query) throw new Error('AI did not produce a SuiteQL query for these instructions.');

  // Enforce status filter rule regardless of which path generated the query
  query = enforceStatusFilterRule(query, instructions);
  plan = { ...plan, query };

  const result = await runMcpSuiteQL(query, userId);

  return {
    plan: { ...plan, query },
    query,
    planSummary: plan.planSummary || null,
    rows: result.items.slice(0, 20),
    totalResults: result.totalResults,
  };
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
      const result = await runMcpSuiteQL(plan.query, agent.user_id);
      rows = result.items || [];
    } catch (firstErr) {
      console.warn(`[AutoAgent] Query failed: ${firstErr.message}\nAttempting self-correction…`);
      const failedQuery = plan.query;

      // If we were on a cached plan, invalidate it first
      if (fromCache) {
        db.prepare(`UPDATE autonomous_agents SET cached_plan = NULL, plan_cached_at = NULL WHERE id = ?`).run(agentId);
      }

      try {
        const corrSystemPrompt = systemPrompt ?? buildPlannerPrompt(agent.instructions);
        const corrUserMessages = userMessages ?? [{ role: 'user', content: agent.instructions }];

        const correctionMessages = [
          ...corrUserMessages,
          { role: 'assistant', content: rawText },
          {
            role: 'user',
            content: `Query failed: "${firstErr.message}".\nFailed query:\n${failedQuery}\nFix it and return the corrected JSON plan.`,
          },
        ];
        const correctedText = await callAI(corrSystemPrompt, correctionMessages, agent.user_id);
        plan = JSON.parse(correctedText);
        if (!plan.query) throw new Error('Corrected plan has no query');
        console.log(`[AutoAgent] Corrected query:\n${plan.query}`);
        const result = await runMcpSuiteQL(plan.query, agent.user_id);
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
          const filledArgs = resolveRuntimeTokens(fillTemplate(plan.actionArguments, row));
          filledArgs.recordType = normalizeRecordType(filledArgs.recordType);
          if (plan.actionTool === 'updateRecord') {
            await callMcpTool('ns_updateRecord', {
              recordType: filledArgs.recordType,
              recordId: String(filledArgs.id),
              data: JSON.stringify(filledArgs.values),
            }, agent.user_id);
          } else if (plan.actionTool === 'createRecord') {
            await callMcpTool('ns_createRecord', {
              recordType: filledArgs.recordType,
              data: JSON.stringify(filledArgs.values),
            }, agent.user_id);
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

  // Resolve runtime tokens at approval time (e.g. {{NOW_UNIX}} → current Unix timestamp)
  const args = resolveRuntimeTokens(JSON.parse(todo.arguments));

  try {
    const agent = db.prepare('SELECT user_id FROM autonomous_agents WHERE id = ?').get(todo.agent_id);
    args.recordType = normalizeRecordType(args.recordType);
    let mcpResult;
    if (todo.action_tool === 'updateRecord') {
      // ns_updateRecord expects: recordType, recordId (not id), data (stringified JSON, not values object)
      mcpResult = await callMcpTool('ns_updateRecord', {
        recordType: args.recordType,
        recordId: String(args.id),
        data: JSON.stringify(args.values),
      }, agent?.user_id);
    } else if (todo.action_tool === 'createRecord') {
      // ns_createRecord expects: recordType, data (stringified JSON, not values object)
      mcpResult = await callMcpTool('ns_createRecord', {
        recordType: args.recordType,
        data: JSON.stringify(args.values),
      }, agent?.user_id);
    } else {
      throw new Error(`Unknown action tool: ${todo.action_tool}`);
    }
    console.log(`[executeTodo] MCP result isError=${mcpResult.isError} text=${mcpResult.text?.slice(0, 300)}`);
    if (mcpResult.isError) {
      throw new Error(`NetSuite rejected the update: ${mcpResult.text}`);
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
