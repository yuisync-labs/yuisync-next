# Legacy incident regression matrix

This matrix turns the operational incidents carried by the legacy YuiSync into explicit regression evidence for YuiSync Next. It does not import legacy implementation choices; it preserves the business invariants behind the incidents.

## Appointment edit semantics

| Scenario | Expected boundary | Evidence |
| --- | --- | --- |
| responsible-only | direct edit; no repricing/reallocation | `src/modules/petshop/lib/appointmentUpdateSemantics.test.js` + `scripts/check-appointment-edit-semantics.mjs` |
| notes-only | direct edit; no repricing/reallocation | same |
| status-only | direct edit; no repricing/reallocation | same + Workerd completion/reopen suites |
| transport-only | direct edit; no repricing/reallocation | same |
| date/time-only | operational transaction | same |
| service-only | operational transaction | same |
| pet/client-only | operational transaction | same |
| price-only | never a billing-intent signal | same |

## Booking, package and financial invariants

| Incident class | Invariant | Behavioral evidence |
| --- | --- | --- |
| duplicate booking / retry | same operation key replays exactly once; reused key with different fingerprint is rejected | `apps/edge-api/test/appointmentCommandIntegration.test.ts` |
| package capacity | reserved + consumed benefits count against capacity; released benefits do not | `apps/edge-api/test/operationalIntegrityV25.test.ts` |
| standalone completion with active package | completion reconciles into the eligible package exactly once | `apps/edge-api/test/packageReconciliationIntegration.test.ts` |
| reopen consumed package | reopen releases package allocation atomically and prevents ghost consumption | `apps/edge-api/test/appointmentReopenIntegration.test.ts` |
| reopen paid sale | reopen cannot invent a provider refund; financial reversal rules are explicit | `apps/edge-api/test/appointmentFinancialReopenIntegration.test.ts` |
| transactional checkout | sale, payment, stock movement and idempotency commit atomically | `apps/edge-api/test/checkoutD1Integration.test.ts` |
| commission/service snapshots | appointment service keeps catalog price, commission and eligibility snapshot from booking | `apps/edge-api/test/appointmentCommandIntegration.test.ts` |

## UI and policy incident classes

| Incident class | Invariant | Evidence |
| --- | --- | --- |
| package card reconstructed from DOM | forbidden; billing presentation comes from explicit appointment state | `src/modules/petshop/components/AgendaBillingLabel.test.jsx` + `scripts/check-no-domain-state-from-dom.mjs` |
| package inferred from price | forbidden; cheap/zero price is not a package signal | `src/modules/petshop/components/AgendaBillingLabel.test.jsx` + `appointmentUpdateSemantics.test.js` |
| exact weight boundaries | no overlap/gap at 0, 10099, 10100, 22100, 22101 and 40000 grams | `src/modules/petshop/lib/serviceWeightBoundaries.test.js` |
| free scheduling / overlap visual lanes | historical/completed/cancelled items do not consume active manual slot capacity | `test/agendaOperationalInfrastructure.test.mjs` and Agenda layout tests |
| MotoDog transport labels/address | transport identity and address are explicit operational data | `test/agendaOperationalInfrastructure.test.mjs` |

## Infrastructure incident classes

| Incident class | Invariant | Evidence |
| --- | --- | --- |
| false-ready by schema version only | readiness verifies required schema capabilities, not only metadata | `apps/edge-api/test/health.test.ts` capability-readiness cases |
| recent D1 upgrade drift | v25, v26 and v27 snapshots upgrade through repository migrations to v28 | `apps/edge-api/test/d1MigrationUpgradeMatrix.test.ts` |
| cross-tenant command access | principal must resolve to active tenant membership | tenant authorization and command integration suites |
| async duplicate delivery | redelivery is idempotent and failed events follow retry/DLQ policy | `apps/edge-api/test/asyncEventRedelivery.test.ts` |
| realtime transport | Durable Object/WebSocket protocol has executable runtime coverage | `apps/edge-api/test/realtimeDurableObject.test.ts` and `realtimeApi.test.ts` |

## CI rule

`check:appointment-edit-semantics` must remain green. New fields may enter the operational transaction boundary only deliberately; responsible/notes/status/transport and price must not silently become package/repricing triggers.

When an incident is found in production, add the invariant and executable evidence here before considering the incident closed.
