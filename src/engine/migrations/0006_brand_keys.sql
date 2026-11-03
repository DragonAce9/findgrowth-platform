CREATE TABLE IF NOT EXISTS brand_keys (
  project_id TEXT NOT NULL,
  stable_id TEXT NOT NULL,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('customer_id', 'order_id')),
  brand_key TEXT NOT NULL,
  PRIMARY KEY (project_id, stable_id)
);
