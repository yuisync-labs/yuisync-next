-- YuiSync operational integrity v25 authoritative finalization.
--
-- This file must remain lexically after every 0025_* invariant migration.
-- Readiness may advertise schema v25 only after the complete operational
-- integrity and transport authority surface has installed successfully.

UPDATE _yuisync_system_metadata
SET value='25', updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
