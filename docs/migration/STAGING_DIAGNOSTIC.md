# Staging diagnostic — Stage 1

Status: active diagnosis only. This document does not authorize production changes or cutover.

## Confirmed staging resources

- Worker: `yuisync-edge-api-staging`
- Main D1: `yuisync-next-staging` (`4abe6b77-3042-4960-88ef-1fdb43d488d1`)
- Auth D1: `yuisync-auth-staging` (`9157ec55-a04d-449e-a92c-710f8e39cd51`)
- Queue: `yuisync-events-staging`
- DLQ: `yuisync-events-dlq-staging`
- Durable Object binding: `COORDINATOR` → `CoordinationDurableObject`

## Last decomposed certification evidence

The remote certification evidence showed 23/26 checks passing. The three failing checks shared the same root error:

- `tenant_isolation` → `AUTH_SIGNIN_HTTP_500`
- `auth_identity_transition` → `AUTH_SIGNIN_HTTP_500`
- `auth_signin` → `AUTH_SIGNIN_HTTP_500`

All of the following were already passing in that evidence: schema v21, D1 domain surfaces, AUTH_DB schema presence, operational reconciliation, frontend no direct Supabase runtime dependency, SPA serving, transient-state drain, queue/DLQ canary, idempotent rerun, rollback bookmarks, and `/ready`.

## Root-cause hypothesis under test

Wrangler reported that Better Auth imports `node:async_hooks` and `node:crypto` but the Worker did not enable the Cloudflare `nodejs_compat` compatibility flag. The staging Worker now opts into `nodejs_compat`; generated Worker types were refreshed afterward.

## Exit criteria for Stage 1

Stage 1 is complete only when:

1. Edge quality checks pass with the compatibility flag and regenerated types.
2. Staging deploy uses the confirmed resource bindings above.
3. `/health` is healthy.
4. `/ready` is healthy and reports DB schema, AUTH_DB, Durable Object, Better Auth, and closed migration capabilities as ready/configured.
5. A rerun of the remote diagnostic no longer returns `AUTH_SIGNIN_HTTP_500`, or produces a more specific isolated failure that can be addressed without changing unrelated architecture.

Do not proceed to data migration, manual application testing, shadow mode, or production cutover until these exit criteria are met.
