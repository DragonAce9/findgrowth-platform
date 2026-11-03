CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cuts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  config_json TEXT NOT NULL,
  events_gz BLOB NOT NULL,
  orders_gz BLOB NOT NULL,
  nps_gz BLOB NOT NULL,
  snapshot_json TEXT,
  recognition_json TEXT,
  created_at TEXT NOT NULL
);
