-- Existing YuiSync administrators predate platform_administrators. Promote only
-- active legacy global profiles that already resolve to the same D1 identity.
INSERT INTO platform_administrators(principal_id,status,created_at_ms,updated_at_ms)
SELECT p.id,'active',unixepoch('now') * 1000,unixepoch('now') * 1000
FROM identity_principals p
JOIN profiles legacy_profile ON legacy_profile.id=p.id
WHERE p.provider='better-auth'
  AND p.status='active'
  AND legacy_profile.role='admin'
  AND legacy_profile.active=1
ON CONFLICT(principal_id) DO NOTHING;
