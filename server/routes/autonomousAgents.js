import express from 'express';
import { executeAgent, executeTodo, denyTodo, testAgentQuery } from '../services/autonomousAgentService.js';
import { scheduleAgent, unscheduleAgent } from '../services/schedulerService.js';
import db from '../db/database.js';

const router = express.Router();

// ─── Agents ────────────────────────────────────────────────────────────────

// GET /api/automation/agents
router.get('/agents', (req, res) => {
  const agents = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM agent_todos WHERE agent_id = a.id AND status = 'pending') AS pending_todos,
      (SELECT COUNT(*) FROM agent_runs  WHERE agent_id = a.id)                        AS total_runs,
      (SELECT status   FROM agent_runs  WHERE agent_id = a.id ORDER BY started_at DESC LIMIT 1) AS last_run_status,
      (SELECT query    FROM agent_runs  WHERE agent_id = a.id ORDER BY started_at DESC LIMIT 1) AS last_run_query
    FROM autonomous_agents a
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
  `).all(req.userId);
  res.json(agents);
});

// POST /api/automation/test-query — generate + run query without any side effects
router.post('/test-query', async (req, res) => {
  const { instructions, feedback, previousPlan, agentId } = req.body;
  if (!instructions?.trim()) return res.status(400).json({ error: 'instructions is required' });
  try {
    const result = await testAgentQuery(
      instructions.trim(), req.userId,
      feedback || null, previousPlan || null,
      agentId || null,
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/agents
router.post('/agents', (req, res) => {
  const { name, description, instructions, schedule, require_approval, notification_frequency, cachedPlan } = req.body;
  if (!name?.trim() || !instructions?.trim() || !schedule?.trim()) {
    return res.status(400).json({ error: 'name, instructions, and schedule are required' });
  }

  const planJson = cachedPlan ? JSON.stringify(cachedPlan) : null;

  const result = db.prepare(`
    INSERT INTO autonomous_agents (name, description, instructions, schedule, require_approval, notification_frequency, user_id, cached_plan, plan_cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END)
  `).run(
    name.trim(),
    description?.trim() || null,
    instructions.trim(),
    schedule.trim(),
    require_approval ? 1 : 0,
    notification_frequency || 'immediate',
    req.userId,
    planJson,
    planJson,
  );

  const agent = db.prepare('SELECT * FROM autonomous_agents WHERE id = ?').get(result.lastInsertRowid);
  scheduleAgent(agent);
  res.json(agent);
});

// PUT /api/automation/agents/:id
router.put('/agents/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM autonomous_agents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  const {
    name, description, instructions, schedule,
    require_approval, notification_frequency, enabled, paused, cachedPlan,
  } = req.body;

  const instructionsChanged = instructions?.trim() && instructions.trim() !== existing.instructions;
  const planJson = cachedPlan ? JSON.stringify(cachedPlan) : null;

  db.prepare(`
    UPDATE autonomous_agents SET
      name = ?, description = ?, instructions = ?, schedule = ?,
      require_approval = ?, notification_frequency = ?, enabled = ?, paused = ?,
      cached_plan = CASE WHEN ? IS NOT NULL THEN ? WHEN ? THEN NULL ELSE cached_plan END,
      plan_cached_at = CASE WHEN ? IS NOT NULL THEN datetime('now') WHEN ? THEN NULL ELSE plan_cached_at END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name?.trim()                 ?? existing.name,
    description !== undefined    ? (description?.trim() || null) : existing.description,
    instructions?.trim()         ?? existing.instructions,
    schedule?.trim()             ?? existing.schedule,
    require_approval !== undefined ? (require_approval ? 1 : 0) : existing.require_approval,
    notification_frequency       ?? existing.notification_frequency,
    enabled !== undefined        ? (enabled ? 1 : 0)  : existing.enabled,
    paused !== undefined         ? (paused  ? 1 : 0)  : existing.paused,
    planJson, planJson, instructionsChanged ? 1 : 0,
    planJson, instructionsChanged ? 1 : 0,
    req.params.id,
  );

  const updated = db.prepare('SELECT * FROM autonomous_agents WHERE id = ?').get(req.params.id);
  unscheduleAgent(Number(req.params.id));
  if (updated.enabled && !updated.paused) scheduleAgent(updated);
  res.json(updated);
});

// DELETE /api/automation/agents/:id
router.delete('/agents/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM autonomous_agents WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  unscheduleAgent(Number(req.params.id));
  db.prepare('DELETE FROM autonomous_agents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/automation/agents/:id/run  — manual trigger
router.post('/agents/:id/run', async (req, res) => {
  try {
    const result = await executeAgent(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/agents/:id/pause
router.post('/agents/:id/pause', (req, res) => {
  db.prepare(`UPDATE autonomous_agents SET paused = 1, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  unscheduleAgent(Number(req.params.id));
  res.json({ success: true });
});

// POST /api/automation/agents/:id/resume
router.post('/agents/:id/resume', (req, res) => {
  db.prepare(`UPDATE autonomous_agents SET paused = 0, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  const agent = db.prepare('SELECT * FROM autonomous_agents WHERE id = ?').get(req.params.id);
  if (agent.enabled) scheduleAgent(agent);
  res.json({ success: true });
});

// ─── Todos / Approvals ──────────────────────────────────────────────────────

// GET /api/automation/todos
router.get('/todos', (req, res) => {
  const todos = db.prepare(`
    SELECT t.*, a.name AS agent_name
    FROM agent_todos t
    JOIN autonomous_agents a ON a.id = t.agent_id
    WHERE t.status = 'pending'
    ORDER BY t.created_at DESC
  `).all();
  res.json(todos.map(t => ({ ...t, arguments: JSON.parse(t.arguments) })));
});

// GET /api/automation/todos/all — includes non-pending for history
router.get('/todos/all', (req, res) => {
  const todos = db.prepare(`
    SELECT t.*, a.name AS agent_name
    FROM agent_todos t
    JOIN autonomous_agents a ON a.id = t.agent_id
    ORDER BY t.created_at DESC
    LIMIT 200
  `).all();
  res.json(todos.map(t => ({ ...t, arguments: JSON.parse(t.arguments) })));
});

// POST /api/automation/todos/:id/approve
router.post('/todos/:id/approve', async (req, res) => {
  try {
    const result = await executeTodo(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/todos/:id/deny
router.post('/todos/:id/deny', (req, res) => {
  try {
    denyTodo(Number(req.params.id), req.body?.reason || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Notifications ──────────────────────────────────────────────────────────

// GET /api/automation/notifications
router.get('/notifications', (req, res) => {
  const { agentId, type, runId } = req.query;
  let sql = `
    SELECT n.*, a.name AS agent_name
    FROM agent_notifications n
    JOIN autonomous_agents a ON a.id = n.agent_id
    WHERE 1=1
  `;
  const params = [];
  if (agentId) { sql += ' AND n.agent_id = ?'; params.push(agentId); }
  if (type)    { sql += ' AND n.type = ?';     params.push(type); }
  if (runId)   { sql += ' AND n.run_id = ?';   params.push(runId); }
  sql += ' ORDER BY n.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/automation/notifications/unread-count
router.get('/notifications/unread-count', (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM agent_notifications n
    JOIN autonomous_agents a ON a.id = n.agent_id
    WHERE n.read = 0 AND a.user_id = ?
  `).get(req.userId);
  const pendingRow = db.prepare(`
    SELECT COUNT(*) AS count FROM agent_todos t
    JOIN autonomous_agents a ON a.id = t.agent_id
    WHERE t.status = 'pending' AND a.user_id = ?
  `).get(req.userId);
  res.json({ unread: row.count, pending: pendingRow.count });
});

// POST /api/automation/notifications/read
router.post('/notifications/read', (req, res) => {
  const { ids } = req.body;
  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE agent_notifications SET read = 1 WHERE id IN (${placeholders})`).run(...ids);
  } else {
    db.prepare(`UPDATE agent_notifications SET read = 1`).run();
  }
  res.json({ success: true });
});

// ─── Run History ────────────────────────────────────────────────────────────

// GET /api/automation/runs
router.get('/runs', (req, res) => {
  const { agentId } = req.query;
  let query = `
    SELECT r.*, a.name AS agent_name
    FROM agent_runs r
    JOIN autonomous_agents a ON a.id = r.agent_id
  `;
  const params = [];
  if (agentId) {
    query += ' WHERE r.agent_id = ?';
    params.push(agentId);
  }
  query += ' ORDER BY r.started_at DESC LIMIT 100';
  res.json(db.prepare(query).all(...params));
});

export default router;
