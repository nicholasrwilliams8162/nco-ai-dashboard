CREATE TABLE IF NOT EXISTS dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'My Dashboard',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  dashboard_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  visualization_type TEXT NOT NULL,
  suiteql_query TEXT NOT NULL,
  visualization_config TEXT NOT NULL,
  original_question TEXT,
  interpretation TEXT,
  cached_data TEXT,
  cached_at DATETIME,
  refresh_interval INTEGER DEFAULT 300,
  grid_x INTEGER DEFAULT 0,
  grid_y INTEGER DEFAULT 0,
  grid_w INTEGER DEFAULT 6,
  grid_h INTEGER DEFAULT 4,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dashboard_id) REFERENCES dashboards(id)
);

CREATE TABLE IF NOT EXISTS query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  suiteql_query TEXT,
  success INTEGER DEFAULT 1,
  error_message TEXT,
  result_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO dashboards (id, name) VALUES (1, 'My Dashboard');

CREATE TABLE IF NOT EXISTS netsuite_tokens (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL,
  scope TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
