-- Keep the existing UUID identity and history. The implicit rowid in this
-- non-unique index orders equal timestamps by insertion, never random UUID.
CREATE INDEX IF NOT EXISTS chat_messages_thread_insertion_idx
 ON chat_messages(tenant_id,module_id,thread_id,created_at_ms);
