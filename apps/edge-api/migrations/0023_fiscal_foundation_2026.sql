-- Fiscal foundation 2026 (MG + NFS-e Nacional)
-- HARD SAFETY: this schema intentionally accepts only homologation.

ALTER TABLE fiscal_documents RENAME TO fiscal_documents_legacy_2026;

CREATE TABLE fiscal_documents (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  document_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'homologation',
  status TEXT NOT NULL DEFAULT 'awaiting_credentials',
  issuer_reference TEXT,
  access_key TEXT,
  protocol TEXT,
  request_hash TEXT NOT NULL,
  response_hash TEXT,
  schema_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  readiness_json TEXT NOT NULL DEFAULT '[]',
  authorized_at_ms INTEGER,
  cancelled_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,sale_id) REFERENCES sales(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (document_type IN ('nfe','nfce','nfse')),
  CHECK (provider IN ('sefaz_mg','nfse_nacional')),
  CHECK (environment = 'homologation'),
  CHECK (status IN ('awaiting_credentials','pending','queued','processing','authorized','rejected','cancelled','failed','contingency')),
  CHECK (length(request_hash)=64),
  CHECK (response_hash IS NULL OR length(response_hash)=64),
  CHECK (json_valid(readiness_json))
) STRICT;

INSERT INTO fiscal_documents(
  tenant_id,module_id,id,sale_id,operation_key,document_type,provider,environment,status,
  issuer_reference,access_key,request_hash,schema_version,ruleset_version,readiness_json,
  authorized_at_ms,cancelled_at_ms,created_at_ms,updated_at_ms
)
SELECT
  tenant_id,module_id,id,sale_id,operation_key,document_type,
  CASE WHEN document_type='nfse' THEN 'nfse_nacional' ELSE 'sefaz_mg' END,
  'homologation',
  status,
  issuer_reference,access_key,request_hash,'legacy','legacy','[]',
  authorized_at_ms,cancelled_at_ms,created_at_ms,updated_at_ms
FROM fiscal_documents_legacy_2026;

DROP TABLE fiscal_documents_legacy_2026;

CREATE UNIQUE INDEX fiscal_documents_operation_unique ON fiscal_documents(tenant_id,module_id,operation_key);
CREATE UNIQUE INDEX fiscal_documents_access_key_unique ON fiscal_documents(tenant_id,module_id,access_key) WHERE access_key IS NOT NULL;
CREATE INDEX fiscal_documents_sale_idx ON fiscal_documents(tenant_id,module_id,sale_id,created_at_ms);
CREATE INDEX fiscal_documents_status_idx ON fiscal_documents(status,updated_at_ms);

CREATE TABLE fiscal_profiles (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  state_registration TEXT,
  municipal_registration TEXT,
  tax_regime TEXT NOT NULL,
  simples_nacional INTEGER NOT NULL DEFAULT 0,
  municipality_ibge TEXT,
  environment TEXT NOT NULL DEFAULT 'homologation',
  certificate_secret_ref TEXT,
  certificate_fingerprint TEXT,
  certificate_valid_until_ms INTEGER,
  nfce_csc_secret_ref TEXT,
  nfce_csc_id TEXT,
  nfce_series INTEGER,
  nfe_series INTEGER,
  nfse_series TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id),
  CHECK (length(cnpj)=14),
  CHECK (tax_regime IN ('simples_nacional','lucro_presumido','lucro_real','other')),
  CHECK (simples_nacional IN (0,1)),
  CHECK (environment = 'homologation'),
  CHECK (municipality_ibge IS NULL OR length(municipality_ibge)=7),
  CHECK (nfce_series IS NULL OR nfce_series BETWEEN 0 AND 999),
  CHECK (nfe_series IS NULL OR nfe_series BETWEEN 0 AND 999)
) STRICT;

CREATE TABLE fiscal_item_rules (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  document_type TEXT NOT NULL,
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  ncm TEXT,
  cfop TEXT,
  csosn TEXT,
  cst TEXT,
  service_code TEXT,
  nbs TEXT,
  cclass_trib TEXT,
  cind_op TEXT,
  tax_data_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,item_type,item_id,ruleset_version),
  CHECK (item_type IN ('product','service')),
  CHECK (document_type IN ('nfe','nfce','nfse')),
  CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms),
  CHECK (json_valid(tax_data_json))
) STRICT;
CREATE INDEX fiscal_item_rules_active_idx ON fiscal_item_rules(tenant_id,module_id,item_type,item_id,valid_from_ms,valid_until_ms);

CREATE TABLE fiscal_document_items (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  fiscal_document_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  sale_item_position INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity_milliunits INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  fiscal_rule_snapshot_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,fiscal_document_id,sale_item_position),
  FOREIGN KEY (tenant_id,module_id,fiscal_document_id) REFERENCES fiscal_documents(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (item_type IN ('product','service')),
  CHECK (quantity_milliunits > 0),
  CHECK (unit_price_cents >= 0 AND subtotal_cents >= 0),
  CHECK (json_valid(fiscal_rule_snapshot_json))
) STRICT;

CREATE TABLE fiscal_events (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  fiscal_document_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,fiscal_document_id) REFERENCES fiscal_documents(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (json_valid(payload_json))
) STRICT;
CREATE UNIQUE INDEX fiscal_events_operation_unique ON fiscal_events(tenant_id,module_id,operation_key);
CREATE INDEX fiscal_events_document_idx ON fiscal_events(tenant_id,module_id,fiscal_document_id,created_at_ms);

UPDATE _yuisync_system_metadata SET value='23', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
