CREATE TABLE IF NOT EXISTS chat_threads (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  channel TEXT NOT NULL, external_thread_id TEXT, client_id TEXT, pet_id TEXT,
  status TEXT NOT NULL DEFAULT 'open', last_message_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,client_id) REFERENCES clients(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,pet_id) REFERENCES pets(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (channel IN ('whatsapp','web','internal')), CHECK (status IN ('open','handoff','closed'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_external_unique ON chat_threads(tenant_id,module_id,channel,external_thread_id) WHERE external_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_messages (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, thread_id TEXT NOT NULL,
  external_message_id TEXT, direction TEXT NOT NULL, actor_type TEXT NOT NULL,
  content_text TEXT NOT NULL DEFAULT '', content_json TEXT, created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,thread_id) REFERENCES chat_threads(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK (direction IN ('inbound','outbound')), CHECK (actor_type IN ('customer','assistant','human','system')),
  CHECK (content_json IS NULL OR json_valid(content_json))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_external_unique ON chat_messages(tenant_id,module_id,external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx ON chat_messages(tenant_id,module_id,thread_id,created_at_ms,id);

UPDATE _yuisync_system_metadata SET value='13', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';