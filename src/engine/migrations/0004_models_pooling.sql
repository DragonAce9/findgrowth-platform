CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT,
  version TEXT NOT NULL,
  model_type TEXT NOT NULL,
  metrics_json TEXT,
  card_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('shadow', 'challenger', 'champion')),
  artifact_path TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE projects ADD COLUMN pooling_consent INTEGER NOT NULL DEFAULT 0;
