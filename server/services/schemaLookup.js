/**
 * schemaLookup.js
 *
 * Fast keyword-based search over the imported NetSuite schema in SQLite.
 * Returns a compact, prompt-ready string of relevant table/column definitions
 * to inject into AI prompts at query time.
 *
 * Usage:
 *   import { lookupSchema } from './schemaLookup.js';
 *   const hint = lookupSchema('open invoices by customer this month');
 *   // Returns ~200-600 tokens of real field definitions
 */

import db from '../db/database.js';

// Core tables that are always included (these appear in nearly every query)
const ALWAYS_INCLUDE = new Set([
  'transaction',
  'transactionline',
  'customer',
]);

// Tables to never surface in hints (internal/system tables that AI shouldn't touch)
const EXCLUDE_TABLES = new Set([
  'systemnote',
  'usernote',
  'loginaudit',
  'statuschangelog',
]);

// Columns to suppress per table — their raw data type from the schema is misleading
// because they require special SuiteQL handling covered by hand-curated guidance above.
const SUPPRESS_COLUMNS = {
  transaction:     new Set(['status', 'mainline', 'amount', 'taxline']),
  transactionline: new Set(['mainline', 'taxline']),
};

// Max columns to include per table in lookup results
const MAX_COLS_PER_TABLE = 20;
// Max tables to include from keyword search (beyond ALWAYS_INCLUDE)
const MAX_EXTRA_TABLES = 6;

/**
 * Check whether the ns_schema_tables table has been populated.
 */
function schemaIsLoaded() {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM ns_schema_tables').get();
    return row.n > 0;
  } catch {
    return false;
  }
}

/**
 * Extract keywords from the instruction text:
 * - split on whitespace/punctuation
 * - lowercase, deduplicate, filter stop words
 */
function extractKeywords(text) {
  const STOP = new Set([
    'a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'may','might','shall','can','need','dare','ought','used',
    'and','or','but','not','no','nor','so','yet','both','either',
    'if','as','at','by','for','in','into','of','on','to','up',
    'with','about','above','after','before','between','from',
    'show','me','all','get','find','list','give','return','display',
    'what','which','who','how','when','where','why','this','that',
    'these','those','my','our','their','its','i','we','you','they',
    'over','under','last','next','past','recent','top','bottom',
    'most','least','more','less','any','some','each','every',
  ]);
  return [...new Set(
    text.toLowerCase()
      .split(/[\s,;:.!?()[\]{}"'\/\\]+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
  )];
}

/**
 * Score a table by how many keywords appear in its id or label.
 */
function scoreTable(tableId, tableLabel, keywords) {
  const haystack = (tableId + ' ' + tableLabel).toLowerCase();
  return keywords.filter(k => haystack.includes(k)).length;
}

/**
 * Find relevant tables from the SQLite schema based on keyword matching.
 * Returns table rows sorted by relevance score (descending).
 */
function findRelevantTables(keywords) {
  if (!keywords.length) return [];

  // Build a LIKE condition for each keyword against id + label
  const conditions = keywords
    .map(() => `(LOWER(id) LIKE ? OR LOWER(label) LIKE ?)`)
    .join(' OR ');
  const params = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);

  const rows = db.prepare(
    `SELECT id, label, column_count FROM ns_schema_tables WHERE (${conditions}) AND id NOT IN (${
      [...EXCLUDE_TABLES].map(() => '?').join(',')
    }) ORDER BY label`
  ).all(...params, ...[...EXCLUDE_TABLES]);

  // Score and sort
  return rows
    .map(r => ({ ...r, score: scoreTable(r.id, r.label, keywords) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Fetch columns for a table, limited to MAX_COLS_PER_TABLE.
 * Returns compact "column_id (dataType)" strings.
 */
function getColumnsForTable(tableId) {
  const rows = db.prepare(
    `SELECT column_id, label, data_type FROM ns_schema_columns WHERE table_id = ? ORDER BY column_id`
  ).all(tableId);

  const suppress = SUPPRESS_COLUMNS[tableId] || new Set();
  return rows
    .filter(c => !suppress.has(c.column_id))
    .slice(0, MAX_COLS_PER_TABLE)
    .map(c => {
      const label = c.label !== c.column_id ? ` [${c.label}]` : '';
      return `${c.column_id}${label} (${c.data_type})`;
    });
}

/**
 * Fetch join relationships between the found tables.
 * Returns at most 15 relationships as compact strings.
 */
function getRelationships(tableIds) {
  if (tableIds.length < 2) return [];
  const placeholders = tableIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT from_table, from_column, to_table, to_column, cardinality, label
     FROM ns_schema_relationships
     WHERE from_table IN (${placeholders}) AND to_table IN (${placeholders})
     LIMIT 20`
  ).all(...tableIds, ...tableIds);

  return rows.map(r => {
    const card = r.cardinality ? ` (${r.cardinality})` : '';
    const lbl = r.label ? ` — ${r.label}` : '';
    return `${r.from_table}.${r.from_column} → ${r.to_table}.${r.to_column}${card}${lbl}`;
  });
}

/**
 * Main export: returns a compact schema hint string for injection into AI prompts.
 * Falls back gracefully if schema hasn't been imported yet.
 *
 * @param {string} instructionText — the user's natural language query or agent instructions
 * @returns {string} — multi-line schema hint, or empty string if schema not loaded
 */
export function lookupSchema(instructionText) {
  if (!schemaIsLoaded()) return '';

  const keywords = extractKeywords(instructionText || '');

  // Start with always-included tables
  const includedIds = new Set(ALWAYS_INCLUDE);
  const tableDetails = [];

  // Add always-included tables first
  for (const tableId of ALWAYS_INCLUDE) {
    const row = db.prepare('SELECT id, label, column_count FROM ns_schema_tables WHERE id = ?').get(tableId);
    if (row) {
      const cols = getColumnsForTable(row.id);
      tableDetails.push({ id: row.id, label: row.label, cols });
    }
  }

  // Add keyword-matched tables (up to MAX_EXTRA_TABLES)
  if (keywords.length > 0) {
    const matched = findRelevantTables(keywords);
    let added = 0;
    for (const t of matched) {
      if (includedIds.has(t.id)) continue;
      if (EXCLUDE_TABLES.has(t.id)) continue;
      if (added >= MAX_EXTRA_TABLES) break;
      includedIds.add(t.id);
      const cols = getColumnsForTable(t.id);
      tableDetails.push({ id: t.id, label: t.label, cols });
      added++;
    }
  }

  if (!tableDetails.length) return '';

  // Format into a compact schema block
  const lines = ['=== NetSuite Schema Reference (from live schema) ==='];

  for (const { id, label, cols } of tableDetails) {
    lines.push(`\nTABLE: ${id} — ${label}`);
    if (cols.length) {
      lines.push('  Columns: ' + cols.join(', '));
    }
  }

  // Join hints for cross-table relationships
  const rels = getRelationships([...includedIds]);
  if (rels.length) {
    lines.push('\nKEY JOINS (from schema):');
    rels.forEach(r => lines.push('  ' + r));
  }

  lines.push('\n(Use these real field names. Prefer BUILTIN.DF(field) for foreign-key display values.)');

  return lines.join('\n');
}

/**
 * Quick summary for logging/debugging — how many schema rows are loaded.
 */
export function schemaStats() {
  if (!schemaIsLoaded()) return { loaded: false };
  return {
    loaded: true,
    tables: db.prepare('SELECT COUNT(*) AS n FROM ns_schema_tables').get().n,
    columns: db.prepare('SELECT COUNT(*) AS n FROM ns_schema_columns').get().n,
    relationships: db.prepare('SELECT COUNT(*) AS n FROM ns_schema_relationships').get().n,
  };
}
