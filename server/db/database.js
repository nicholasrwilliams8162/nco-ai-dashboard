import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATA_DIR can be set to a Railway persistent volume mount path (e.g. /data)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = join(DATA_DIR, 'dashboard.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Migrate: app_settings key/value store
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Migrate: add oauth_pending table for storing PKCE state server-side
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_pending (
    state       TEXT PRIMARY KEY,
    verifier    TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

// Migrate: agent action history
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    instruction TEXT NOT NULL,
    tool        TEXT NOT NULL,
    arguments   TEXT NOT NULL DEFAULT '{}',
    result      TEXT,
    success     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migrate: enhance agent_history with record tracking and revert support
const agentCols = db.pragma('table_info(agent_history)').map(c => c.name);
if (!agentCols.includes('record_type'))  db.exec("ALTER TABLE agent_history ADD COLUMN record_type TEXT");
if (!agentCols.includes('record_id'))    db.exec("ALTER TABLE agent_history ADD COLUMN record_id TEXT");
if (!agentCols.includes('before_state')) db.exec("ALTER TABLE agent_history ADD COLUMN before_state TEXT");
if (!agentCols.includes('status'))       db.exec("ALTER TABLE agent_history ADD COLUMN status TEXT NOT NULL DEFAULT 'success'");
if (!agentCols.includes('reverted_at'))  db.exec("ALTER TABLE agent_history ADD COLUMN reverted_at TEXT");

// Migrate: autonomous agents + scheduling system
db.exec(`
  CREATE TABLE IF NOT EXISTS autonomous_agents (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT NOT NULL,
    description            TEXT,
    instructions           TEXT NOT NULL,
    schedule               TEXT NOT NULL,
    enabled                INTEGER NOT NULL DEFAULT 1,
    paused                 INTEGER NOT NULL DEFAULT 0,
    require_approval       INTEGER NOT NULL DEFAULT 1,
    notification_frequency TEXT NOT NULL DEFAULT 'immediate',
    last_run_at            TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    records_found   INTEGER NOT NULL DEFAULT 0,
    actions_created INTEGER NOT NULL DEFAULT 0,
    plan_summary    TEXT,
    query           TEXT,
    error           TEXT,
    FOREIGN KEY (agent_id) REFERENCES autonomous_agents(id) ON DELETE CASCADE
  )
`);

// Migrate: add query column to agent_runs if not present
const agentRunCols = db.pragma('table_info(agent_runs)').map(c => c.name);
if (!agentRunCols.includes('query')) db.exec("ALTER TABLE agent_runs ADD COLUMN query TEXT");

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_todos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id    INTEGER NOT NULL,
    run_id      INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    action_tool TEXT NOT NULL,
    description TEXT NOT NULL,
    arguments   TEXT NOT NULL DEFAULT '{}',
    record_id   TEXT,
    record_type TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES autonomous_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id)   REFERENCES agent_runs(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   INTEGER NOT NULL,
    run_id     INTEGER,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES autonomous_agents(id) ON DELETE CASCADE
  )
`);

// Migrate: agent memory / learning log
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   INTEGER NOT NULL,
    type       TEXT NOT NULL,
    summary    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES autonomous_agents(id) ON DELETE CASCADE
  )
`);

// Migrate: plan caching on autonomous_agents
const agentCols2 = db.pragma('table_info(autonomous_agents)').map(c => c.name);
if (!agentCols2.includes('cached_plan'))    db.exec("ALTER TABLE autonomous_agents ADD COLUMN cached_plan TEXT");
if (!agentCols2.includes('plan_cached_at')) db.exec("ALTER TABLE autonomous_agents ADD COLUMN plan_cached_at TEXT");

// Migrate: deny_reason on agent_todos
const todoCols = db.pragma('table_info(agent_todos)').map(c => c.name);
if (!todoCols.includes('deny_reason')) db.exec("ALTER TABLE agent_todos ADD COLUMN deny_reason TEXT");

// Migrate: add client_id / client_secret columns if they don't exist yet
const tokenColumns = db.pragma('table_info(netsuite_tokens)').map(c => c.name);
if (!tokenColumns.includes('client_id')) {
  db.exec("ALTER TABLE netsuite_tokens ADD COLUMN client_id TEXT NOT NULL DEFAULT ''");
}
if (!tokenColumns.includes('client_secret')) {
  db.exec("ALTER TABLE netsuite_tokens ADD COLUMN client_secret TEXT NOT NULL DEFAULT ''");
}
if (!tokenColumns.includes('user_id')) {
  db.exec("ALTER TABLE netsuite_tokens ADD COLUMN user_id TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_netsuite_tokens_user_id ON netsuite_tokens(user_id)");
}

// Migrate: add user_id to oauth_pending
const opCols = db.pragma('table_info(oauth_pending)').map(c => c.name);
if (!opCols.includes('user_id')) {
  db.exec("ALTER TABLE oauth_pending ADD COLUMN user_id TEXT");
}

// Migrate: add user_id to dashboards
const dashboardCols = db.pragma('table_info(dashboards)').map(c => c.name);
if (!dashboardCols.includes('user_id')) {
  db.exec("ALTER TABLE dashboards ADD COLUMN user_id TEXT");
}

// Migrate: add user_id to query_history
const qhCols = db.pragma('table_info(query_history)').map(c => c.name);
if (!qhCols.includes('user_id')) {
  db.exec("ALTER TABLE query_history ADD COLUMN user_id TEXT");
}

// Migrate: add user_id to agent_history
const ahCols2 = db.pragma('table_info(agent_history)').map(c => c.name);
if (!ahCols2.includes('user_id')) {
  db.exec("ALTER TABLE agent_history ADD COLUMN user_id TEXT");
}

// Migrate: add user_id to autonomous_agents
const aaCols = db.pragma('table_info(autonomous_agents)').map(c => c.name);
if (!aaCols.includes('user_id')) {
  db.exec("ALTER TABLE autonomous_agents ADD COLUMN user_id TEXT");
}

// Per-user settings (Groq API key etc.) — separate from global app_settings
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  )
`);

// NetSuite schema import — populated by scripts/importNetSuiteSchema.js
db.exec(`
  CREATE TABLE IF NOT EXISTS ns_schema_tables (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    column_count INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ns_schema_columns (
    table_id  TEXT NOT NULL,
    column_id TEXT NOT NULL,
    label     TEXT NOT NULL,
    data_type TEXT NOT NULL,
    PRIMARY KEY (table_id, column_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ns_schema_relationships (
    from_table  TEXT NOT NULL,
    from_column TEXT NOT NULL,
    to_table    TEXT NOT NULL,
    to_column   TEXT NOT NULL,
    cardinality TEXT,
    join_type   TEXT,
    label       TEXT
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_ns_cols_table ON ns_schema_columns(table_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ns_rels_from  ON ns_schema_relationships(from_table)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ns_rels_to    ON ns_schema_relationships(to_table)`);

export default db;
