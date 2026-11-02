-- Record of a duplicate-tutor merge: one row per client or pet touched, with
-- the row as it was before, so a merge can be checked or undone.
-- role: 'kept' (the tutor that stays), 'merged' (the duplicate that was
-- removed, into_client_id says where it went), 'pet' (a pet that moved or was
-- archived), 'normalized' (a tutor whose CPF lost its leading zeros).
CREATE TABLE IF NOT EXISTS client_merge_log (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('kept','merged','pet','normalized')),
  row_id TEXT NOT NULL,
  into_client_id TEXT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, batch_id, role, row_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS client_merge_log_into_idx ON client_merge_log(tenant_id, module_id, into_client_id);
