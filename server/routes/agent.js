import express from 'express';
import { planAgentAction, executeAgentPlan } from '../services/agenticEngine.js';
import { updateRecord, inactivateRecord } from '../services/restRecordClient.js';
import db from '../db/database.js';

const router = express.Router();

// POST /api/agent/plan
// Groq decides what MCP tool to call and with what args — no NetSuite side effects
router.post('/plan', async (req, res) => {
  const { instruction } = req.body;
  if (!instruction?.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }

  const { clarifications = [] } = req.body;
  try {
    const plan = await planAgentAction(instruction.trim(), clarifications);
    res.json(plan);
  } catch (err) {
    console.error('[Agent] Plan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/execute
// Executes a confirmed plan against NetSuite via MCP
router.post('/execute', async (req, res) => {
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'planId is required' });

  try {
    const result = await executeAgentPlan(planId);
    res.json(result);
  } catch (err) {
    console.error('[Agent] Execute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/history
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT id, instruction, tool, arguments, result, success,
           record_type, record_id, before_state, status, reverted_at, created_at
    FROM agent_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.userId);
  res.json(rows.map(r => ({
    ...r,
    arguments: JSON.parse(r.arguments),
    before_state: r.before_state ? JSON.parse(r.before_state) : null,
  })));
});

// POST /api/agent/history/:id/revert
router.post('/history/:id/revert', async (req, res) => {
  const row = db.prepare(`
    SELECT * FROM agent_history WHERE id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Action not found' });
  if (row.status === 'reverted') return res.status(400).json({ error: 'Already reverted' });
  if (!row.record_type || !row.record_id) {
    return res.status(400).json({ error: 'This action has no revertible record' });
  }

  try {
    const args = JSON.parse(row.arguments);
    const beforeState = row.before_state ? JSON.parse(row.before_state) : null;

    if (row.tool === 'createRecord') {
      // Revert a create by inactivating the record
      await inactivateRecord(row.record_type, row.record_id);
    } else if (row.tool === 'updateRecord' && beforeState) {
      // Revert an update by restoring the before-state fields
      await updateRecord(row.record_type, row.record_id, beforeState);
    } else {
      return res.status(400).json({ error: 'No revert strategy available for this action' });
    }

    db.prepare(`
      UPDATE agent_history SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?
    `).run(row.id);

    res.json({ success: true, message: `${row.record_type} ${row.record_id} reverted successfully.` });
  } catch (err) {
    console.error('[Agent] Revert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
