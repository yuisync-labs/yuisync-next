-- YuiSync operational integrity v25 sequencing marker.
--
-- Do NOT promote schema_version here. Additional v25 migrations (including
-- transport authority) still execute after this file. The authoritative v25
-- promotion lives in 0025_99_operational_integrity_finalize.sql so readiness
-- cannot report v25 if a later invariant failed to install.
SELECT 1;
