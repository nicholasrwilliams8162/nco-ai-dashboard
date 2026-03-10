/**
 * importNetSuiteSchema.js
 *
 * One-time (re-runnable) script that parses netsuite-schema.json and loads
 * tables, columns, and relationships into the dashboard SQLite database.
 *
 * Usage:
 *   node server/scripts/importNetSuiteSchema.js
 *   DATA_DIR=/path/to/data node server/scripts/importNetSuiteSchema.js
 */

import Database from 'better-sqlite3';
import { readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '../db');
const DB_PATH = join(DATA_DIR, 'dashboard.db');
const SCHEMA_JSON = resolve(__dirname, '../../netsuite-schema.json');

console.log(`DB:     ${DB_PATH}`);
console.log(`Schema: ${SCHEMA_JSON}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure tables exist (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS ns_schema_tables (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, column_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ns_schema_columns (
    table_id TEXT NOT NULL, column_id TEXT NOT NULL, label TEXT NOT NULL, data_type TEXT NOT NULL,
    PRIMARY KEY (table_id, column_id)
  );
  CREATE TABLE IF NOT EXISTS ns_schema_relationships (
    from_table TEXT NOT NULL, from_column TEXT NOT NULL,
    to_table TEXT NOT NULL, to_column TEXT NOT NULL,
    cardinality TEXT, join_type TEXT, label TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ns_cols_table ON ns_schema_columns(table_id);
  CREATE INDEX IF NOT EXISTS idx_ns_rels_from  ON ns_schema_relationships(from_table);
  CREATE INDEX IF NOT EXISTS idx_ns_rels_to    ON ns_schema_relationships(to_table);
`);

// Clear existing data for clean re-import
db.exec(`DELETE FROM ns_schema_tables; DELETE FROM ns_schema_columns; DELETE FROM ns_schema_relationships;`);

console.log('Reading schema JSON…');
const raw = JSON.parse(readFileSync(SCHEMA_JSON, 'utf8'));
console.log(`Loaded: ${raw.tableCount} tables, ${raw.columnCount} columns, ${raw.relationshipCount} relationships`);

// Normalise a label — strip [Missing Label:...] wrappers
function cleanLabel(label, fallback) {
  if (!label || label.startsWith('[Missing')) return fallback;
  return label;
}

// ─── Tables + Columns ────────────────────────────────────────────────────────

const insertTable = db.prepare(`
  INSERT OR REPLACE INTO ns_schema_tables (id, label, column_count) VALUES (?, ?, ?)
`);
const insertColumn = db.prepare(`
  INSERT OR REPLACE INTO ns_schema_columns (table_id, column_id, label, data_type) VALUES (?, ?, ?, ?)
`);

const importTablesAndColumns = db.transaction((tables) => {
  let colCount = 0;
  for (const t of tables) {
    const label = cleanLabel(t.label, t.id);
    insertTable.run(t.id, label, t.columns.length);
    for (const c of t.columns) {
      const colLabel = cleanLabel(c.label, c.id);
      insertColumn.run(t.id, c.id, colLabel, c.dataType || 'STRING');
      colCount++;
    }
  }
  return colCount;
});

console.log('Importing tables and columns…');
const colCount = importTablesAndColumns(raw.tables);
console.log(`  Imported ${raw.tables.length} tables, ${colCount} columns`);

// ─── Relationships ────────────────────────────────────────────────────────────

const insertRel = db.prepare(`
  INSERT INTO ns_schema_relationships (from_table, from_column, to_table, to_column, cardinality, join_type, label)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const importRelationships = db.transaction((rels) => {
  for (const r of rels) {
    insertRel.run(r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.cardinality || null, r.joinType || null, r.label || null);
  }
});

console.log('Importing relationships…');
importRelationships(raw.relationships);
console.log(`  Imported ${raw.relationships.length} relationships`);

// ─── Summary ─────────────────────────────────────────────────────────────────

const stats = {
  tables:        db.prepare('SELECT COUNT(*) AS n FROM ns_schema_tables').get().n,
  columns:       db.prepare('SELECT COUNT(*) AS n FROM ns_schema_columns').get().n,
  relationships: db.prepare('SELECT COUNT(*) AS n FROM ns_schema_relationships').get().n,
};

console.log(`\nDone. DB now has:`);
console.log(`  ${stats.tables} tables`);
console.log(`  ${stats.columns} columns`);
console.log(`  ${stats.relationships} relationships`);
console.log(`\nDB size: ${(statSync(DB_PATH).size / 1024 / 1024).toFixed(1)} MB`);
