CREATE TABLE IF NOT EXISTS luna_conversations (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  state_json TEXT NOT NULL DEFAULT '{}',
  summary_text TEXT,
  last_source_message_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, conversation_id),
  FOREIGN KEY (tenant_id, module_id, conversation_id)
    REFERENCES chat_threads(tenant_id, module_id, id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (status IN ('active', 'handoff', 'paused', 'closed')),
  CHECK (json_valid(state_json)),
  CHECK (version >= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS luna_proposals (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  committed_operation_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  FOREIGN KEY (tenant_id, module_id, conversation_id)
    REFERENCES luna_conversations(tenant_id, module_id, conversation_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (operation_kind IN ('customer_registration','pet_registration','appointment_create','appointment_reschedule','appointment_cancel','product_order_create')),
  CHECK (status IN ('collecting','awaiting_confirmation','executing','completed','invalidated','failed')),
  CHECK (version >= 1),
  CHECK (json_valid(payload_json))
) STRICT;
CREATE INDEX IF NOT EXISTS luna_proposals_conversation_status_idx
  ON luna_proposals(tenant_id, module_id, conversation_id, status, updated_at_ms, id);

CREATE TABLE IF NOT EXISTS luna_tool_runs (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  CHECK (json_valid(arguments_json)),
  CHECK (json_valid(result_json)),
  CHECK (status IN ('succeeded','rejected','failed')),
  CHECK (duration_ms >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS luna_tool_runs_trace_idx
  ON luna_tool_runs(tenant_id, module_id, conversation_id, trace_id, created_at_ms, id);

CREATE TABLE IF NOT EXISTS luna_usage_ledger (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  CHECK (provider IN ('groq')),
  CHECK (prompt_tokens >= 0 AND completion_tokens >= 0 AND model_calls >= 0 AND tool_calls >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS luna_usage_created_idx
  ON luna_usage_ledger(tenant_id, module_id, created_at_ms, id);

CREATE TABLE IF NOT EXISTS luna_event_outbox (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  published_at_ms INTEGER,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, event_id),
  UNIQUE (tenant_id, module_id, idempotency_key),
  CHECK (json_valid(payload_json)),
  CHECK (status IN ('pending','published','failed')),
  CHECK (attempt_count >= 0)
) STRICT;
CREATE INDEX IF NOT EXISTS luna_event_outbox_due_idx
  ON luna_event_outbox(status, next_attempt_at_ms, tenant_id, module_id, event_id);
