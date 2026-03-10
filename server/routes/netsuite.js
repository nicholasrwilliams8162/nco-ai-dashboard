import express from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { testConnection, runSuiteQL } from '../services/netsuiteClient.js';
import { validateSuiteQL } from '../middleware/validateQuery.js';
import { listMcpTools, callMcpTool } from '../services/mcpClient.js';
import { schemaStats } from '../services/schemaLookup.js';
import db from '../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// GET /api/netsuite/schema-stats — show how many schema rows are loaded
router.get('/schema-stats', (req, res) => {
  res.json(schemaStats());
});

// POST /api/netsuite/import-schema — parse netsuite-schema.json and load into SQLite
// Runs synchronously (blocks briefly) — intended for one-time/occasional use
router.post('/import-schema', (req, res) => {
  const SCHEMA_JSON = resolve(__dirname, '../../../netsuite-schema.json');

  let raw;
  try {
    raw = JSON.parse(readFileSync(SCHEMA_JSON, 'utf8'));
  } catch (err) {
    return res.status(400).json({ error: `Could not read netsuite-schema.json: ${err.message}` });
  }

  // Clear existing data
  db.exec('DELETE FROM ns_schema_tables; DELETE FROM ns_schema_columns; DELETE FROM ns_schema_relationships;');

  function cleanLabel(label, fallback) {
    if (!label || label.startsWith('[Missing')) return fallback;
    return label;
  }

  const insertTable  = db.prepare('INSERT OR REPLACE INTO ns_schema_tables (id, label, column_count) VALUES (?, ?, ?)');
  const insertColumn = db.prepare('INSERT OR REPLACE INTO ns_schema_columns (table_id, column_id, label, data_type) VALUES (?, ?, ?, ?)');
  const insertRel    = db.prepare('INSERT INTO ns_schema_relationships (from_table, from_column, to_table, to_column, cardinality, join_type, label) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const importAll = db.transaction(() => {
    let colCount = 0;
    for (const t of raw.tables) {
      const label = cleanLabel(t.label, t.id);
      insertTable.run(t.id, label, t.columns.length);
      for (const c of t.columns) {
        insertColumn.run(t.id, c.id, cleanLabel(c.label, c.id), c.dataType || 'STRING');
        colCount++;
      }
    }
    for (const r of raw.relationships) {
      insertRel.run(r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.cardinality || null, r.joinType || null, r.label || null);
    }
    return colCount;
  });

  try {
    const colCount = importAll();
    const stats = schemaStats();
    res.json({ ok: true, tables: stats.tables, columns: colCount, relationships: stats.relationships });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
