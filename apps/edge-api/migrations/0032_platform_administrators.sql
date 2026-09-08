-- Platform administrators are YuiSync identities, not tenant memberships.
CREATE TABLE IF NOT EXISTS platform_administrators (
  principal_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (principal_id) REFERENCES identity_principals(id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS platform_administrators_status_idx
  ON platform_administrators(status,principal_id);
