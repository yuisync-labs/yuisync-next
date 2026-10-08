-- Additive journal: operational drafts, proposals and historic migrations stay intact.
CREATE TABLE IF NOT EXISTS luna_turn_steps (
 tenant_id TEXT NOT NULL,
 module_id TEXT NOT NULL CHECK(module_id='petshop'),
 conversation_id TEXT NOT NULL,
 source_message_id TEXT NOT NULL,
 step_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 input_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','complete','failed')),
 result_json TEXT,
 error_code TEXT,
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,module_id,conversation_id,source_message_id,step_key)
) STRICT;
CREATE INDEX IF NOT EXISTS luna_turn_steps_retention ON luna_turn_steps(tenant_id,module_id,updated_at_ms);
CREATE INDEX IF NOT EXISTS luna_turn_steps_progress ON luna_turn_steps(tenant_id,module_id,conversation_id,source_message_id,updated_at_ms DESC);
