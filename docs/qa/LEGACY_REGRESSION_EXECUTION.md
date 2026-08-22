# Legacy regression execution matrix

This QA matrix converts the historical legacy incident list into executable evidence. It runs only against a disposable staging tenant/users and never targets production or Quatro Patas data.

## Browser-visible scenarios

1. Traverse all petshop module routes and fail on page errors or HTTP 5xx.
2. Create a stocked physical product and a real agenda service.
3. Create one tutor with address data and two pets with distinct weights (10.1 kg and 22.1 kg).
4. Create a package tied to a real service, search the multi-pet tutor and explicitly choose the intended pet.
5. Create an appointment for the other pet, add the real service, use MotoDog `buscar_e_levar`, verify the inherited address, save an operational note, then perform a notes-only edit and verify persistence.
6. Enter POS mode, add the stocked product and execute transactional checkout through the UI.

## Semantic and backend invariants

The workflow also executes the existing executable evidence for:

- direct vs operational appointment edit routing;
- no domain state reconstructed from DOM or price;
- exact service-weight boundaries;
- active slot overlap semantics;
- duplicate/retried booking idempotency and operation fingerprints;
- package reservation/consumption/release accounting;
- package reconciliation on standalone completion;
- atomic package release on reopen;
- financial reopen/reversal semantics;
- transactional checkout atomicity, stock and payment integrity;
- catalog price/commission/service snapshots;
- readiness capability checks and D1 upgrade matrix;
- async redelivery/idempotency/DLQ behavior;
- Durable Object/WebSocket realtime behavior.

## Acceptance rule

A scenario is not considered closed merely because the UI renders. The browser matrix and the relevant Workerd/D1 invariant must both be green where the incident spans UI and backend state. Test mismatches must be corrected to the current intended contract; application assertions must not be weakened to manufacture a green run.
