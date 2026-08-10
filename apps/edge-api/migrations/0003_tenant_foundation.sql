CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(trim(id)) BETWEEN 1 AND 160),
  CHECK (length(trim(slug)) BETWEEN 1 AND 120),
  CHECK (slug = lower(slug)),
  CHECK (length(trim(name)) BETWEEN 1 AND 160)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique
  ON tenants (slug);

CREATE INDEX IF NOT EXISTS tenants_status_idx
  ON tenants (status, id);

CREATE TABLE IF NOT EXISTS identity_principals (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(trim(id)) BETWEEN 1 AND 160),
  CHECK (length(trim(provider)) BETWEEN 1 AND 32),
  CHECK (provider = lower(provider)),
  CHECK (length(trim(subject)) BETWEEN 1 AND 255)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS identity_principals_provider_subject_unique
  ON identity_principals (provider, subject);

CREATE INDEX IF NOT EXISTS identity_principals_status_idx
  ON identity_principals (status, id);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, principal_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (principal_id) REFERENCES identity_principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS tenant_memberships_principal_status_idx
  ON tenant_memberships (principal_id, status, tenant_id);

CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_status_idx
  ON tenant_memberships (tenant_id, status, principal_id);

UPDATE _yuisync_system_metadata
SET value = '3', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
