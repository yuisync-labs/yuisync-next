# Legacy browser regression — staging

This suite is an on-demand staging QA path. It is deliberately separate from the production deployment gate so a browser download or UI regression can never turn a normal release into a multi-hour deployment.

## What it executes

`test/e2e/legacy-regression-p0.spec.js` signs into a disposable Better Auth tenant and exercises the real staging UI/API for the historical P0 incident classes:

- all petshop routes;
- one tutor with multiple pets;
- cross-tenant access denial;
- exact 10.099 kg / 10.100 kg service boundary behavior;
- species mismatch rejection;
- package-backed appointment creation and operational snapshots;
- MotoDog address/mode edit without commercial reallocation;
- package completion replay and reopen release;
- transactional PDV checkout replay/idempotency;
- readiness and authenticated realtime;
- mobile overflow on P0 screens.

The workflow also re-runs the Workerd integration tests for boundaries that are safer and more exact below the browser layer: duplicate booking fingerprints, full weight boundary matrix, package capacity/reconciliation, paid-sale reopen blocking, checkout atomicity, async redelivery/DLQ behavior, realtime runtime and capability-based readiness.

## Safety

The workflow uses only `cloudflare-staging`. `staging-e2e-fixtures.mjs` creates a tenant guarded by the `e2e-*...-tenant` naming contract and random Better Auth users ending in `@staging.invalid`. `staging-legacy-regression-fixtures.mjs` refuses any environment other than staging. Cleanup runs with `if: always()` and removes the foreign isolation fixture before the base fixture recursively removes all data scoped to the disposable tenant.

No Quatro Patas or production records are read or mutated by this suite.
