CREATE TABLE IF NOT EXISTS managed_user_profiles (
  principal_id TEXT PRIMARY KEY NOT NULL,
  staff_type TEXT NOT NULL DEFAULT 'funcionario'
    CHECK (staff_type IN ('funcionario','banho_tosa','veterinaria','motodog','vendedor_caixa','gerente')),
  preferred_tenant_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (principal_id) REFERENCES identity_principals(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (preferred_tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS managed_user_profiles_preferred_tenant_idx
  ON managed_user_profiles (preferred_tenant_id, principal_id);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  actor_principal_id TEXT,
  target_principal_id TEXT,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (actor_principal_id) REFERENCES identity_principals(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  FOREIGN KEY (target_principal_id) REFERENCES identity_principals(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  CHECK (length(trim(action)) BETWEEN 1 AND 80),
  CHECK (json_valid(metadata_json))
) STRICT;

CREATE INDEX IF NOT EXISTS admin_audit_events_tenant_created_idx
  ON admin_audit_events (tenant_id, created_at_ms DESC, id);

CREATE INDEX IF NOT EXISTS admin_audit_events_target_created_idx
  ON admin_audit_events (target_principal_id, created_at_ms DESC, id);

UPDATE _yuisync_system_metadata
SET value = '22', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
