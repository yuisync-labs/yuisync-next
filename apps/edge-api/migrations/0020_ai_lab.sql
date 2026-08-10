CREATE TABLE IF NOT EXISTS ai_niches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_prompt TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS ai_companies (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  niche_id TEXT NOT NULL,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  bot_name TEXT NOT NULL DEFAULT 'Yui',
  temperature_milli INTEGER NOT NULL DEFAULT 500,
  model_name TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  welcome_message TEXT,
  kb_namespace TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  schedule_free_status TEXT NOT NULL DEFAULT 'available',
  schedule_booked_status TEXT NOT NULL DEFAULT 'booked',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (niche_id) REFERENCES ai_niches(id) ON DELETE RESTRICT,
  CHECK (temperature_milli BETWEEN 0 AND 2000),
  CHECK (status IN ('active','inactive'))
) STRICT;
CREATE INDEX IF NOT EXISTS ai_companies_scope_idx ON ai_companies(tenant_id,module_id,status,name,id);

CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  changed_by TEXT,
  change_note TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,company_id) REFERENCES ai_companies(tenant_id,module_id,id) ON DELETE CASCADE,
  UNIQUE (tenant_id,module_id,company_id,layer,version),
  CHECK (layer IN ('core','niche','company')),
  CHECK (version >= 1),
  CHECK (is_active IN (0,1))
) STRICT;
CREATE INDEX IF NOT EXISTS ai_prompt_versions_company_idx ON ai_prompt_versions(tenant_id,module_id,company_id,layer,version DESC,created_at_ms DESC);

CREATE TABLE IF NOT EXISTS ai_training_documents (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  title TEXT NOT NULL,
  object_key TEXT,
  mime_type TEXT,
  file_size INTEGER,
  content_text TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  uploaded_by TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,company_id) REFERENCES ai_companies(tenant_id,module_id,id) ON DELETE CASCADE,
  CHECK (status IN ('active','archived')),
  CHECK (file_size IS NULL OR file_size >= 0),
  CHECK (json_valid(tags_json)),
  CHECK (json_valid(metadata_json))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS ai_training_documents_object_idx ON ai_training_documents(tenant_id,module_id,object_key) WHERE object_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_training_documents_company_idx ON ai_training_documents(tenant_id,module_id,company_id,status,created_at_ms DESC,id);

CREATE TABLE IF NOT EXISTS ai_playground_runs (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  created_by TEXT,
  customer_phone TEXT NOT NULL,
  input_message TEXT NOT NULL,
  parsed_intent_json TEXT NOT NULL DEFAULT '{}',
  action TEXT,
  reply TEXT,
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,company_id) REFERENCES ai_companies(tenant_id,module_id,id) ON DELETE CASCADE,
  CHECK (json_valid(parsed_intent_json)),
  CHECK (json_valid(raw_response_json))
) STRICT;
CREATE INDEX IF NOT EXISTS ai_playground_runs_company_idx ON ai_playground_runs(tenant_id,module_id,company_id,created_at_ms DESC,id);

DROP VIEW IF EXISTS compat_niches;
CREATE VIEW compat_niches AS
SELECT id,name,base_prompt,datetime(created_at_ms/1000,'unixepoch') AS created_at FROM ai_niches;

DROP VIEW IF EXISTS compat_companies;
CREATE VIEW compat_companies AS
SELECT tenant_id,module_id,id,niche_id,name,system_prompt,bot_name,
  temperature_milli/1000.0 AS temperature,model_name,welcome_message,kb_namespace,
  CASE WHEN status='active' THEN 1 ELSE 0 END AS is_active,
  schedule_free_status,schedule_booked_status,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,
  datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM ai_companies;

DROP VIEW IF EXISTS compat_prompt_versions;
CREATE VIEW compat_prompt_versions AS
SELECT tenant_id,module_id,id,company_id,layer,content,version,is_active,changed_by,change_note,
  datetime(created_at_ms/1000,'unixepoch') AS created_at
FROM ai_prompt_versions;

DROP VIEW IF EXISTS compat_ai_training_documents;
CREATE VIEW compat_ai_training_documents AS
SELECT tenant_id,module_id,id,company_id,title,
  CASE WHEN object_key IS NULL THEN NULL ELSE 'yuisync-ai-docs' END AS storage_bucket,
  object_key AS storage_path,mime_type,file_size,content_text,json(tags_json) AS tags,status,json(metadata_json) AS metadata,uploaded_by,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM ai_training_documents;

DROP VIEW IF EXISTS compat_ai_playground_runs;
CREATE VIEW compat_ai_playground_runs AS
SELECT tenant_id,module_id,id,company_id,created_by,customer_phone,input_message,
  json(parsed_intent_json) AS parsed_intent,action,reply,json(raw_response_json) AS raw_response,
  datetime(created_at_ms/1000,'unixepoch') AS created_at
FROM ai_playground_runs;

UPDATE _yuisync_system_metadata SET value='20',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
