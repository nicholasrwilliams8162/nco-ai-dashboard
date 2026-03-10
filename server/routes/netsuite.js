import express from 'express';
import { testConnection, runSuiteQL } from '../services/netsuiteClient.js';
import { validateSuiteQL } from '../middleware/validateQuery.js';
import { listMcpTools, callMcpTool } from '../services/mcpClient.js';

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

// GET /api/netsuite/mcp-tools — list MCP tools with full schemas (debug)
router.get('/mcp-tools', async (req, res) => {
  try {
    const tools = await listMcpTools(true, req.userId);
    res.json(tools);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/netsuite/mcp-call — call an MCP tool directly (debug)
router.post('/mcp-call', async (req, res) => {
  const { tool, args } = req.body;
  if (!tool) return res.status(400).json({ error: 'tool is required' });
  try {
    const result = await callMcpTool(tool, args || {}, req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
