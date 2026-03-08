import express from 'express';
import { processNaturalLanguageQuery } from '../services/aiService.js';
import db from '../db/database.js';

const router = express.Router();

// POST /api/ai/query
router.post('/query', async (req, res) => {
  const { question } = req.body;
  if (!question?.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const result = await processNaturalLanguageQuery(question.trim(), req.userId);

    // Log to query history
    db.prepare(`
      INSERT INTO query_history (question, suiteql_query, success, result_count, user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      question,
      result.query || null,
      result.success ? 1 : 0,
      result.data?.length || 0,
      req.userId
    );

    res.json({ ...result, originalQuestion: question });
  } catch (error) {
    console.error('AI query error:', error);

    db.prepare(`
      INSERT INTO query_history (question, success, error_message, user_id)
      VALUES (?, 0, ?, ?)
    `).run(question, error.message, req.userId);

    res.status(500).json({ error: error.message });
  }
});

// GET /api/ai/history
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT id, question, suiteql_query, success, error_message, result_count, created_at
    FROM query_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.userId);
  res.json(rows);
});

export default router;
