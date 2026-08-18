-- Active-tab integration hardening discovered by the PetShop UI -> D1 audit.

-- Chat threads keep the operational core compact while persisting the fields that the
-- dashboard actually edits/displays. Existing rows receive safe null/default values.
ALTER TABLE chat_threads ADD COLUMN customer_name TEXT;
ALTER TABLE chat_threads ADD COLUMN intent TEXT;
ALTER TABLE chat_threads ADD COLUMN assigned_staff_key TEXT;
ALTER TABLE chat_threads ADD COLUMN csat_score INTEGER CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5);
ALTER TABLE chat_threads ADD COLUMN closed_at_ms INTEGER;
ALTER TABLE chat_threads ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json));

DROP VIEW IF EXISTS compat_chat_sessions;
CREATE VIEW compat_chat_sessions AS
SELECT
  tenant_id,
  module_id,
  id,
  client_id,
  pet_id,
  external_thread_id AS phone,
  external_thread_id AS customer_phone,
  customer_name,
  CASE status
    WHEN 'open' THEN 'bot'
    WHEN 'handoff' THEN 'human'
    WHEN 'closed' THEN 'closed'
    ELSE 'bot'
  END AS status,
  intent,
  assigned_staff_key AS employee_id,
  csat_score,
  json(context_json) AS context,
  CASE WHEN last_message_at_ms IS NULL THEN NULL ELSE datetime(last_message_at_ms/1000,'unixepoch') END AS last_message_at,
  datetime(created_at_ms/1000,'unixepoch') AS opened_at,
  CASE WHEN closed_at_ms IS NULL THEN NULL ELSE datetime(closed_at_ms/1000,'unixepoch') END AS closed_at,
  datetime(created_at_ms/1000,'unixepoch') AS created_at,
  datetime(updated_at_ms/1000,'unixepoch') AS updated_at
FROM chat_threads;

DROP VIEW IF EXISTS compat_chat_messages;
CREATE VIEW compat_chat_messages AS
SELECT
  tenant_id,
  module_id,
  id,
  thread_id AS session_id,
  external_message_id,
  direction,
  CASE actor_type
    WHEN 'customer' THEN 'user'
    WHEN 'assistant' THEN 'assistant'
    WHEN 'human' THEN 'human_agent'
    ELSE actor_type
  END AS role,
  content_text AS content,
  content_json,
  CASE WHEN content_json IS NULL THEN NULL ELSE json(content_json) END AS metadata,
  CASE WHEN content_json IS NULL THEN NULL ELSE CAST(json_extract(content_json,'$.tokens_used') AS INTEGER) END AS tokens_used,
  CASE WHEN content_json IS NULL THEN NULL ELSE CAST(json_extract(content_json,'$.dashboard_turn_version') AS INTEGER) END AS dashboard_turn_version,
  datetime(created_at_ms/1000,'unixepoch') AS sent_at,
  datetime(created_at_ms/1000,'unixepoch') AS created_at
FROM chat_messages;

-- One scope may have at most one open cash register. Triggers prevent new races without
-- rewriting historical data during migration; if legacy duplicates exist they remain visible
-- for explicit reconciliation, while no new duplicate can be created.
DROP TRIGGER IF EXISTS cash_register_single_open_insert_guard;
CREATE TRIGGER cash_register_single_open_insert_guard
BEFORE INSERT ON cash_register
WHEN NEW.closed_at_ms IS NULL
  AND EXISTS (
    SELECT 1 FROM cash_register existing
    WHERE existing.tenant_id=NEW.tenant_id
      AND existing.module_id=NEW.module_id
      AND existing.closed_at_ms IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'CASH_REGISTER_ALREADY_OPEN');
END;

DROP TRIGGER IF EXISTS cash_register_single_open_reopen_guard;
CREATE TRIGGER cash_register_single_open_reopen_guard
BEFORE UPDATE OF closed_at_ms ON cash_register
WHEN NEW.closed_at_ms IS NULL
  AND EXISTS (
    SELECT 1 FROM cash_register existing
    WHERE existing.tenant_id=NEW.tenant_id
      AND existing.module_id=NEW.module_id
      AND existing.id<>NEW.id
      AND existing.closed_at_ms IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'CASH_REGISTER_ALREADY_OPEN');
END;

UPDATE _yuisync_system_metadata
SET value='30', updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
