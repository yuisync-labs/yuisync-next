# ADR — WhatsApp Business App Coexistence history sync

Status: **BLOCKED / evidence required**

Date: 2026-08-17

## Context

YuiSync Next must preserve WhatsApp Business App coexistence without confusing historical synchronization with a new customer message.

The migration plan requires a provider-specific history implementation only after two independent pieces of evidence exist:

1. current official Meta documentation that defines the supported coexistence/history synchronization mechanism and its semantics;
2. a real payload captured from the YuiSync Meta App/WhatsApp number and committed only after sanitization.

The official Meta WhatsApp Business Platform material reviewed on 2026-08-17 documents Embedded Signup, WABA discovery/assignment, WABA app subscription and webhook notifications. The reviewed official material did not provide a sufficiently explicit, current contract for the coexistence historical-message payload/window that would justify promoting the legacy parser into Next.

Official material reviewed:

- Meta WhatsApp Business Platform — Embedded Signup collection: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Meta WhatsApp Business Platform — Subscribe App to WhatsApp Business Account: https://www.postman.com/meta/whatsapp-business-platform/request/0yubu4i/subscribe-app-to-whatsapp-business-account

Absence of a documented contract in the material reviewed is **not** evidence that history sync does not exist. It means the implementation gate remains closed.

## Decision

Do **not** implement or port provider-specific coexistence history parsing from legacy code until the gate below is satisfied.

No fabricated fixture, guessed field name, third-party payload example or legacy implementation may be treated as the source of truth.

### Gate to unlock implementation

All items are mandatory:

- [ ] official Meta source identified and linked to the exact coexistence/history mechanism;
- [ ] supported trigger/event/subscription documented;
- [ ] documented time/window/retention behavior captured if Meta defines one;
- [ ] documented message identity/replay semantics captured if Meta defines them;
- [ ] real payload captured from the configured YuiSync Meta App/number;
- [ ] payload sanitized before commit;
- [ ] fixture reviewed to contain no access token, App Secret, customer message text, real phone number, customer name or identifying provider IDs;
- [ ] implementation contract derived from official source + observed fixture;
- [ ] replay/idempotency tests added;
- [ ] tests prove historical records never enter the live-message execution path.

## Non-negotiable invariants

1. `historical message != live incoming customer message`.
2. Importing history must not invoke Luna.
3. Importing history must not invoke automations, notifications, appointment tools, checkout, fiscal flows or any operational side effect.
4. A historical record must be idempotent under replay.
5. Tenant scope must come from persisted WABA/`phone_number_id` ownership; no global/singleton tenant fallback.
6. Historical provider payloads must be normalized at the infrastructure boundary before application/domain use.
7. History import must be separately observable from live webhook ingestion.
8. Failure or uncertainty in history import must never block live WhatsApp webhook processing.

## Fixture policy

The future real fixture belongs under:

`test/fixtures/whatsapp/coexistence/`

Before committing it:

- replace WABA, business, phone-number and message IDs with deterministic fake IDs;
- replace all phone numbers with reserved/test values;
- replace customer/business names with neutral placeholders;
- replace message bodies/media captions with synthetic content;
- remove tokens, signatures, URLs containing credentials and trace information that could identify the production account;
- preserve only structural fields required to prove parsing semantics.

The fixture filename should include the provider event/mechanism name documented by Meta, not a guessed internal label.

## Intended implementation after the gate opens

Only after the evidence gate is complete:

1. introduce a separate historical-ingress contract;
2. implement a Meta adapter/parser derived from the official contract and fixture;
3. resolve tenant through the WA3 connection repository;
4. persist history through an idempotent history-only repository/service;
5. tag records explicitly as historical/imported;
6. keep historical ingestion disconnected from the live Luna/operation dispatcher;
7. add fixture-based contract, replay, tenant-isolation and side-effect suppression tests.

## Consequences

### Positive

- avoids encoding an undocumented provider payload into the new architecture;
- protects Luna and operational flows from historical replay;
- keeps live webhook behavior independent of optional historical import;
- creates a concrete evidence checklist instead of an ambiguous TODO.

### Trade-off

Full history synchronization is not considered implemented until Meta documentation and the real sanitized fixture satisfy this ADR. This is an intentional launch gate decision, not unfinished speculative code.

## Rollback

This ADR is documentation-only and does not alter runtime, Meta configuration, D1 schema or Cloudflare routing. Reverting it has no external side effects.
