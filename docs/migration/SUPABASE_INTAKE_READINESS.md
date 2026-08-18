# Supabase -> D1 migration intake readiness

Status: **pre-cutover preparation only**. This machinery must not import production data until a migration run is explicitly planned and authorized.

## Goal

Provide a fail-closed landing zone for a legacy Supabase tenant so YuiSync Next can stage a consistent bulk snapshot, protect credentials, reconcile counts/checksums, and then perform a short delta cutover. The source remains authoritative until reconciliation is green.

## Safety rules

- Never commit tenant IDs, service-role keys, database URLs, password hashes, access tokens, app secrets, verify tokens, portal tokens, push tokens, or migration vault keys.
- Never write to the legacy Supabase during preparation or extraction.
- Never migrate Supabase sessions/refresh tokens. Better Auth creates fresh sessions after the first sign-in.
- Password hashes may be preserved only through the sensitive Better Auth path; they must never enter normal manifests, logs, artifacts, or `migration_source_records`.
- `migration_source_records` is a temporary, sanitized landing zone. Secret-like fields are stripped and encrypted separately in `migration_secret_vault`.
- Unknown non-empty source tables fail readiness. Views are recomputed from base tables instead of copied.
- Production writes require a separately authorized migration run. The default preparation mode is dry-run/read-only.

## Landing-zone tables

`0030_99_legacy_migration_intake.sql` adds five migration-only tables while keeping the application schema version at 30:

1. `migration_runs` — source identity/snapshot metadata and lifecycle.
2. `migration_source_records` — sanitized source rows with checksums and stable source keys.
3. `migration_secret_vault` — AES-256-GCM sealed credential material with context-bound AAD and HMAC fingerprints.
4. `migration_table_checkpoints` — row counts/checksums/cursors for bulk and delta runs.
5. `migration_reconciliation` — source/destination metrics used by the final cutover gate.

The landing zone deliberately has no FK to `tenants`, allowing a source tenant record to be staged before canonical creation.

## Identity strategy

- Scope users by **explicit `profile_tenants` membership only**. Do not materialize legacy global-admin bypasses into unrelated tenants.
- Preserve the source user UUID as Better Auth `user.id` and as the Next identity principal ID/subject when collision checks pass.
- Preserve compatible bcrypt hashes in Better Auth `account.password` without ever logging them.
- Convert source module permissions to the Next stored shape `{ module: { role } }`.
- Create `managed_user_profiles` for `staff_type` and preferred tenant.
- Do not migrate Supabase refresh tokens or sessions.

## Clients / pets strategy

The current legacy database contains normalized `clients` and `pets` alongside historical data inside `clients.details`. The old Phase 7 flattened projector must not be used for the real cutover.

The intake projector is deterministic:

1. Preserve every source client row as a canonical client.
2. For each pet, prefer a client with the same ID.
3. If absent, match one unique normalized `(owner_name, phone)` client.
4. If there is no match, synthesize a client from the pet owner fields using the pet ID, only when that ID is not already a client.
5. If multiple owner matches exist, fail closed for manual resolution.
6. Preserve historical `clients.details` in the sanitized landing record even when those fields are not part of the normalized D1 client schema.

## Secrets and integrations

Known secret-bearing legacy fields are explicitly registered, and recursive secret detection catches nested equivalents. Signed/tokenized URL query parameters are redacted as well.

A migration vault key must be an operator-side 32-byte random key encoded as base64. It must be supplied through a protected environment variable or CI secret, never checked into git. AES-GCM ciphertext is context-bound to run/table/key/path so ciphertext cannot be moved to another row undetected.

WhatsApp metadata can be staged, but runtime credentials must ultimately be consumed into the Next encrypted WhatsApp credential vault. Legacy Telegram credentials are preserved encrypted for later integration decisions; they are not treated as evidence of Next Telegram feature parity.

## Readiness gate

A run is eligible for import planning only when all of these are green:

- every non-empty source base table is registered;
- the five intake tables exist in the target schema;
- every selected auth user has a supported bcrypt hash;
- selected users come from explicit tenant memberships;
- all secret-bearing rows have a configured migration vault;
- Supabase-hosted files are either absent or have a file migration path;
- clients/pets project without ambiguity and without losing pets;
- source/staged row counts and checksums match;
- after canonical import, reconciliation metrics match before cutover.

## Production cutover shape

1. Bulk snapshot while the legacy app remains online.
2. Stage + canonicalize in a non-production rehearsal and reconcile.
3. Rehearse real-user Better Auth sign-in with migrated bcrypt credentials.
4. Capture a final source watermark.
5. Short legacy write freeze.
6. Delta snapshot since the watermark.
7. Reconcile counts, checksums, financial totals, inventory, appointments, subscriptions, and identity membership.
8. Switch application traffic only after the cutover gate is green.
9. Keep Supabase read-only for the rollback/verification window; do not destroy it during cutover.
