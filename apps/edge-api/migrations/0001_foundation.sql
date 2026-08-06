CREATE TABLE IF NOT EXISTS _yuisync_system_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT OR IGNORE INTO _yuisync_system_metadata (key, value)
VALUES ('schema_version', '1');
