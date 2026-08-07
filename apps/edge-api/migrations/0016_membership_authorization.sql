ALTER TABLE tenant_memberships ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('owner','admin','manager','staff','member'));
ALTER TABLE tenant_memberships ADD COLUMN module_permissions_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(module_permissions_json));

CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_role_status_idx
  ON tenant_memberships (tenant_id, role, status, principal_id);

UPDATE _yuisync_system_metadata
SET value='16', updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
