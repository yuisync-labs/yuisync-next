-- YuiSync operational integrity v25 finalization.
--
-- The preceding 0025_* migrations introduce the explicit billing intent,
-- benefit allocation ledger, capacity guards, sale origin metadata and integer
-- weight bands. Promote the runtime schema identity only after every v25
-- invariant has been installed successfully.

UPDATE _yuisync_system_metadata
SET value='25', updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
