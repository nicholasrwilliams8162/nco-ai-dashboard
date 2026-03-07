import express from 'express';
import { testConnection, runSuiteQL } from '../services/netsuiteClient.js';
import { validateSuiteQL } from '../middleware/validateQuery.js';

const router = express.Router();

// GET /api/netsuite/test — verify connectivity
router.get('/test', async (req, res) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});

// POST /api/netsuite/query — run a raw SuiteQL query (for advanced use)
router.post('/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  try {
    const validated = validateSuiteQL(query);
    const result = await runSuiteQL(validated);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
