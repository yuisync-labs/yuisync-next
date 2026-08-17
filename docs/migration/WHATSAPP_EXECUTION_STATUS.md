# Meta / WhatsApp migration execution status

Updated: 2026-08-17

This file tracks execution against `WHATSAPP_META_MIGRATION.md`. It does not replace the original audit or relax any gate.

## Completed phases

### WA1 — Inventory + Contracts

Completed and merged.

- canonical WhatsApp contracts;
- application ports;
- migration inventory and risk map;
- contract and boundary tests.

### WA2 — Meta Graph Adapter

Completed and merged.

- Meta Graph transport isolated behind `WhatsAppMessagingPort`;
- central Graph version;
- timeout/error classification and redaction;
- normalized successful sends as `submitted`.

### WA3 — Cloudflare Webhook

Completed and merged.

- raw-body `X-Hub-Signature-256` verification retained;
- tenant resolved from persisted `phone_number_id`/WABA ownership;
- no first-tenant/global-tenant selection;
- D1 ingress receipts and idempotent live-message persistence;
- live ingress explicitly tagged as `live_webhook`.

### WA4 — Embedded Signup + Onboarding

Completed and merged in PR #52.

- Embedded Signup initiated in the existing Meta WhatsApp UI;
- browser passes only temporary authorization code and Embedded Signup asset IDs;
- Worker exchanges code and resolves WABA/phone assets server-side;
- WABA subscription required before connection becomes `connected`;
- per-tenant/per-phone access token encrypted in D1 with AES-256-GCM;
- schema advanced to v27;
- no Meta callback/domain cutover performed.

## Current phase

### WA5 — Outbound + Status

Implemented on `agent/wa5-outbound-status` and under CI in PR #53.

- D1 schema v28 adds idempotent outbound records and provider delivery receipts;
- unified `sendWhatsAppOutboundText` service accepts actor `human`, `assistant` or `system`;
- exact tenant connection selection; more than one connected phone requires explicit `phone_number_id`;
- encrypted WA4 credential vault feeds the WA2 Graph adapter;
- new authenticated `/api/whatsapp/send` route intercepts the previous edge send route;
- legacy `send_message` review action is disabled;
- accepted Graph send is persisted as `submitted`, never optimistic `sent`;
- signed webhook statuses reconcile `sent`, `delivered`, `read` and `failed` by provider message ID;
- provider timestamp prevents out-of-order webhooks from regressing message state;
- duplicate idempotency keys do not send twice.

## Gated phase

### WA6 — Coexistence History Sync

**BLOCKED — do not implement provider history parsing yet.**

Required gate before code may import historical messages:

1. current official Meta documentation must explicitly describe the coexistence/history event or supported history-sync mechanism;
2. a real payload from the configured Meta App/number must be captured;
3. the payload must be sanitized and committed as a fixture with secrets, phone numbers, customer content and IDs anonymized;
4. an ADR must document the official source, observed fixture, replay/idempotency semantics and retention/window assumptions;
5. tests must prove `historical message != live incoming customer message` and that history can never trigger Luna, automations, notifications or operational side effects.

The official Meta material verified so far supports Embedded Signup, WABA subscription, message sending and status tracking, but does not yet provide enough verified detail in the sources reviewed for us to safely promote the legacy coexistence-history parser into Next.

## Final phase

### WA7 — `yuisync.app` cutover

Not executed externally yet.

Internal prerequisites:

- WA5 merged and green;
- WA6 either implemented after its gate or explicitly declared not required for launch;
- staging D1 migrations applied through the current schema;
- required Worker secrets configured server-side;
- `/ready` green on the target Worker;
- smoke tests for onboarding, inbound, duplicate inbound, human outbound and delivery status;
- legacy direct WhatsApp sending disabled;
- callback rollback target recorded before changing Meta.

External cutover sequence:

1. record current Meta callback and DNS/routes;
2. deploy the already-tested Worker release;
3. apply D1 migrations before routing production traffic;
4. configure server-only WhatsApp secrets without exposing them to frontend variables;
5. verify `GET /api/whatsapp/webhook` challenge on the target public hostname;
6. switch Meta callback to the Cloudflare endpoint;
7. send one controlled inbound and one controlled outbound message;
8. verify tenant resolution, single persistence, `submitted -> sent/delivered/read` reconciliation and Inbox visibility;
9. observe errors/retries before removing compatibility paths;
10. only after the WhatsApp cutover is stable, remove obsolete global fallback variables and legacy transport code.

Rollback is the reverse routing operation: restore the recorded previous Meta callback/route while leaving normalized D1 records intact for diagnosis. Do not roll back by deleting production message history.
