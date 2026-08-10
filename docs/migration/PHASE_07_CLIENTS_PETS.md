# Phase 7 — Clients + Pets

## Goal

Normalize the legacy petshop customer model before later agenda, package, checkout and Luna migrations depend on it.

The legacy application uses `clients` as a pet-shaped record: each row repeats tutor PII and stores pet fields under `details`. The legacy `pets` table is an opportunistic mirror whose `id` is synchronized from `clients.id`; it is not authoritative enough to become the Next domain model.

YuiSync Next therefore models the relationship explicitly:

- `clients`: tutor/customer identity and contact data;
- `pets`: pet data with a mandatory composite foreign key to its tutor inside the same tenant and module.

## Ownership invariants

Every client and pet is scoped by `(tenant_id, module_id)`.

`pets (tenant_id, module_id, client_id)` references `clients (tenant_id, module_id, id)`. Cross-tenant and cross-module links fail at the D1 constraint boundary in addition to application authorization.

No D1 query may treat an ID supplied by the caller as authority. Tenant authorization remains a separate application concern; the composite keys prevent accidental cross-scope relationships after authorization.

## Legacy identity mapping

Each legacy `clients.id` is preserved as `pets.id` because downstream legacy appointments/subscriptions currently use that row as the pet/customer identity.

Tutor identity is derived conservatively:

1. when `clients.details.tutor_group_id` is explicitly present, it becomes the normalized `clients.id` for all rows in that explicit group;
2. otherwise the legacy `clients.id` becomes the normalized `clients.id` for that single row.

Phone and CPF are **not** authoritative merge keys. Matching contact data does not merge tutors during migration.

If rows that explicitly share one `tutor_group_id` disagree on tutor fields, projection fails closed with `SOURCE_TUTOR_GROUP_CONFLICT`. The migration must be reconciled at the source instead of silently choosing one version.

## Field mapping

Tutor fields:

- `name` <- legacy `clients.name`
- `document` <- canonical digits from `clients.document`
- `phone` <- canonical digits from `clients.phone`
- `email` <- lower-case `clients.email`
- `birth_date` <- `clients.details.tutor_birth_date`
- `address` <- `clients.address`
- `address_number` <- `clients.details.address_number`
- `address_complement` <- `clients.details.address_complement`
- `address_reference` <- `clients.details.address_reference`
- `neighborhood` <- `clients.neighborhood`
- `city` <- `clients.city`
- `postal_code` <- canonical digits from `clients.details.zip_code`
- `notes` <- legacy client/tutor notes
- `status` <- legacy `active`

Pet fields:

- `id` <- legacy `clients.id`
- `client_id` <- normalized tutor ID described above
- `name` <- `clients.details.pet_name`
- `species` <- normalized `clients.details.species`
- `breed` <- `clients.details.breed`
- `birth_date` <- `clients.details.birth_date`
- `weight_kg` <- `clients.details.weight_kg`
- `color` <- `clients.details.color`
- `notes` <- `clients.details.pet_notes` when explicitly present, otherwise the current legacy fallback to `clients.notes`
- `status` <- legacy `active`

Legacy timestamps are not part of the semantic reconciliation checksum. Destination timestamps describe the D1 insertion event and exact reruns must not rewrite them.

## Migration pipeline

The slice uses the same safety model as the foundation migration work:

1. Supabase extraction is GET-only and tenant/module scoped.
2. Source rows are projected to `phase7-clients-pets/v1`.
3. Manifests hash logical records; raw PII remains outside committed artifacts.
4. D1 extraction uses fixed SELECT statements only.
5. The writer validates the exact projection shape before writes.
6. Existing destination rows must either match the projected value or the write is rejected.
7. Unexpected destination IDs in the selected scope reject the migration.
8. Each tutor plus its pets is written in one D1 `batch()` transaction.
9. Exact reruns are idempotent and do not update physical timestamps.
10. Full-domain reconciliation is required before any read cutover.

A large tenant cannot be one D1 transaction. Atomicity is therefore per tutor group, while the outer migration is restartable and reconciled. A Time Travel bookmark must be captured by the staging/production orchestration layer before controlled activation; restore remains a manual, database-wide recovery decision.

## Deliberate exclusions

This slice does not migrate appointments, subscriptions, packages, sales, MotoDog, chat or fiscal records. Those domains will reference the normalized pet/tutor identities in their own slices.

The frontend continues to use the legacy Supabase shape until the later Frontend + APIs slice. This avoids dual ownership before the backend contracts and dependent domains are ready.

Production and the legacy `main` branch are not activated or modified by this slice.