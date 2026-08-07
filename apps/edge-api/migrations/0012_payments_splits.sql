CREATE TABLE IF NOT EXISTS payments (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, sale_id TEXT NOT NULL,
  operation_key TEXT NOT NULL, method TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', provider TEXT, provider_reference TEXT,
  received_at_ms INTEGER, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (method IN ('pix','cash','card')), CHECK (amount_cents > 0),
  CHECK (status IN ('pending','awaiting_proof','authorized','received','failed','cancelled','refunded'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS payments_scope_operation_unique ON payments(tenant_id,module_id,operation_key);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_unique ON payments(tenant_id,module_id,provider,provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_splits (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, payment_id TEXT NOT NULL, position INTEGER NOT NULL,
  recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', provider_reference TEXT, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,payment_id,position),
  FOREIGN KEY (tenant_id,module_id,payment_id) REFERENCES payments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (recipient_type IN ('store','professional','platform')), CHECK (amount_cents >= 0),
  CHECK (status IN ('pending','scheduled','paid','failed','cancelled'))
) STRICT;

CREATE TABLE IF NOT EXISTS financial_effects (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, operation_key TEXT NOT NULL,
  effect_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0, last_error_code TEXT, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,operation_key,effect_type),
  CHECK (effect_type IN ('payment_capture','payment_cancel','split_transfer','refund')),
  CHECK (status IN ('pending','processing','completed','failed')), CHECK (attempt_count >= 0)
) STRICT;

UPDATE _yuisync_system_metadata SET value='12', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';