-- Prepared responses are not presentation evidence. Acceptance copies context.
CREATE TABLE luna_response_drafts (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,conversation_id TEXT NOT NULL,source_message_id TEXT NOT NULL,
 reply_text TEXT NOT NULL,context_json TEXT NOT NULL CHECK(json_valid(context_json)),created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,module_id,conversation_id,source_message_id),
 FOREIGN KEY(tenant_id,module_id,conversation_id) REFERENCES luna_conversations(tenant_id,module_id,conversation_id)
) STRICT;
CREATE TABLE luna_conversation_memory (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,conversation_id TEXT NOT NULL,
 outbound_message_id TEXT NOT NULL,context_json TEXT NOT NULL CHECK(json_valid(context_json)),presented_at_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,module_id,conversation_id),
 FOREIGN KEY(tenant_id,module_id,conversation_id) REFERENCES luna_conversations(tenant_id,module_id,conversation_id),
 FOREIGN KEY(tenant_id,module_id,outbound_message_id) REFERENCES chat_messages(tenant_id,module_id,id)
) STRICT;
CREATE TABLE luna_turn_decisions (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,conversation_id TEXT NOT NULL,source_message_id TEXT NOT NULL,
 decision_json TEXT NOT NULL CHECK(json_valid(decision_json)),created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,module_id,conversation_id,source_message_id),
 FOREIGN KEY(tenant_id,module_id,conversation_id) REFERENCES luna_conversations(tenant_id,module_id,conversation_id)
) STRICT;
