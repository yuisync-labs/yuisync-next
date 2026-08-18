# Supabase -> D1 migration intake readiness

Status: **pre-cutover preparation only**. This machinery must not import production tenant data until a migration run is explicitly planned and authorized.

## Goal

Provide a fail-closed landing zone for a legacy Supabase tenant so YuiSync Next can stage a consistent bulk snapshot, protect credentials, reconcile counts/checksums, and then perform a short delta cutover. The source remains authoritative until reconciliation is green.

## Safety rules

- Never commit tenant IDs, service-role keys, database URLs, password hashes, access tokens, app secrets, verify tokens, portal tokens, push tokens, or migration vault keys.
- Never write to the legacy Supabase during preparation or extraction.
- Never migrate Supabase sessions/refresh tokens. Better Auth creates fresh sessions after the first sign-in.
- Password hashes may be preserved only through the sensitive Better Auth path; they must never enter normal manifests, logs, artifacts, or `migration_source_records`.
- `migration_source_records` is a temporary, sanitized landing zone. Secret-like fields are stripped and encrypted separately in `migration_secret_vault`.
- Oversized source rows never become oversized D1 rows: payloads above 32 KB are gzip-compressed and split into <=32 KB binary chunks stored as base64.
- Unknown non-empty source tables fail readiness. Views are recomputed from base tables instead of copied.
- Production tenant-data writes require a separately authorized migration run. The default preparation mode is dry-run/read-only.

## Landing-zone tables

`0030_99_legacy_migration_intake.sql` adds six migration-only tables while keeping the application schema version at 30:

1. `migration_runs` — source identity/snapshot metadata and lifecycle.
2. `migration_source_records` — sanitized source-row metadata, checksums and stable source keys; small payloads remain inline.
3. `migration_source_payload_chunks` — gzip/base64 chunks for payloads too large to keep inline safely under D1 row/statement limits.
4. `migration_secret_vault` — AES-256-GCM sealed credential material with context-bound AAD and HMAC fingerprints.
5. `migration_table_checkpoints` — row counts/checksums/cursors for bulk and delta runs.
6. `migration_reconciliation` — source/destination metrics used by the final cutover gate.

The landing zone deliberately has no FK from a run to `tenants`, allowing a source tenant record to be staged before canonical tenant creation. Chunk rows do have an FK to their source-record metadata so incomplete/extra payload fragments can be detected deterministically.

## Large legacy rows

Cloudflare D1 has a 2 MB maximum row/string/BLOB size and a 100 KB maximum individual SQL-statement size. The intake layer therefore keeps a 32 KB safety boundary for inline payloads and chunk bytes.

For a large sanitized source record:

1. Create deterministic canonical JSON.
2. SHA-256 the uncompressed canonical JSON.
3. gzip the canonical JSON.
4. split compressed bytes into <=32 KB chunks;
5. store chunks as base64 rows;
6. store original byte length + chunk count + checksum on the source-record metadata;
7. require contiguous chunk indexes, decompression, byte-length equality and checksum equality before a payload is accepted for canonical import.

The D1 writer rejects any generated SQL statement above its 90 KB safety limit. It uses idempotent row-level operations and writes table checkpoints last, so an interrupted Wrangler file import can be retried without pretending a partially staged table is complete.

## Identity strategy

- Scope users by **explicit `profile_tenants` membership only**. Do not materialize legacy global-admin bypasses into unrelated tenants.
- Preserve the source user UUID as Better Auth `user.id` and as the Next identity principal ID/subject when collision checks pass.
- Preserve compatible bcrypt hashes in Better Auth `account.password` without ever logging them.
- Convert source module permissions to the Next stored shape `{ module: { role } }`.
- Create `managed_user_profiles` for `staff_type` and preferred tenant.
- Do not migrate Supabase refresh tokens or sessions.
- Before writing an identity, run the remote collision preflight against `AUTH_DB.user`, `AUTH_DB.account`, `identity_principals`, `tenant_memberships`, and the target tenant. A conflicting ID/email/subject/membership blocks the write; an exact previous attempt is classified separately as a retry.

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

## Physical schema installation

`.github/workflows/migration-intake-schema-install.yml` installs **only the empty intake schema**, first in staging and then in production. It is intentionally separate from tenant-data migration.

The installer:

- only accepts an issue opened by a repository `OWNER`/`MEMBER`;
- requires an exact current-main SHA and exact authorization marker;
- requires a successful Quality run for that exact SHA;
- checks the remote D1 migration ledger and refuses to proceed if any unrelated migration is pending;
- captures a D1 Time Travel bookmark before the staging and production schema change;
- applies the one intake migration;
- proves all six intake tables exist and are empty;
- proves `_yuisync_system_metadata.schema_version` remains `30`;
- rechecks production `/health` and `/ready` after the additive schema install;
- never reads or imports legacy tenant rows.

## Readiness gate

A run is eligible for import planning only when all of these are green:

- every non-empty source base table is registered;
- all six intake tables exist in the target schema;
- every selected auth user has a supported bcrypt hash;
- selected users come from explicit tenant memberships;
- identity collision preflight is green before auth writes;
- all secret-bearing rows have a configured migration vault;
- Supabase-hosted files are either absent or have a file migration path;
- oversized source payloads have chunking support enabled;
- clients/pets project without ambiguity and without losing pets;
- source/staged row counts and checksums match;
- after canonical import, reconciliation metrics match before cutover.

## Production cutover shape

1. Bulk snapshot while the legacy app remains online.
2. Stage + canonicalize in a non-production rehearsal and reconcile.
3. Rehearse real-user Better Auth sign-in with migrated bcrypt credentials.
4. Capture a final source watermark.
5. Short legacy write freeze.
6. Delta snapshot since the watermark; tables without a trustworthy update timestamp use full key/checksum diff rather than an unsafe timestamp assumption.
7. Reconcile counts, checksums, financial totals, inventory, appointments, subscriptions, and identity membership.
8. Switch application traffic only after the cutover gate is green.
9. Keep Supabase read-only for the rollback/verification window; do not destroy it during cutover.
