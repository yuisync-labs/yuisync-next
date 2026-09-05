-- Persistent Better Auth limits shared by Worker instances; no password data.
CREATE TABLE IF NOT EXISTS rateLimit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limit_last_request_idx ON rateLimit(lastRequest);
