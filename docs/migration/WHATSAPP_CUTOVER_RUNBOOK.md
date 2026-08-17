# WhatsApp Cloudflare production cutover runbook

Status: **PREPARED — external cutover not executed**

Updated: 2026-08-17

This runbook is the WA7 operational procedure. It deliberately separates repository readiness from external Meta/Cloudflare changes.

## 1. Preconditions

Do not switch production traffic until every applicable item below is true.

### Repository

- [ ] WA1–WA5 are merged.
- [ ] WA6 gate is recorded; if history sync is launch-critical, the WA6 ADR must be unlocked and implemented first.
- [ ] WA7 PR is green on quality, build and `edge:check`.
- [ ] no Edge runtime code uses global `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TENANT_ID` or `WHATSAPP_MODULE_ID`.
- [ ] Meta review/status/templates use Cloudflare APIs rather than the legacy Supabase handler.

### Production Cloudflare resources

The repository currently defines staging resources. Production IDs must be real values obtained from the target Cloudflare account; never copy staging IDs into production.

Before cutover confirm:

- [ ] production Worker/environment exists;
- [ ] production main D1 exists;
- [ ] production auth D1 exists;
- [ ] required Durable Object/Queue bindings are configured if the production runtime enables them;
- [ ] migrations through the repository's current schema version have been applied to production D1;
- [ ] the deployed Worker returns `ready` from `/ready` using production bindings;
- [ ] the intended `yuisync.app` route/custom domain is attached to the correct Worker deployment.

### Server-only WhatsApp/Meta secrets

Required by the current Cloudflare WhatsApp runtime:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`
- `WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI`
- `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY`
- optional `WHATSAPP_GRAPH_VERSION` only when intentionally overriding the repository default

Rules:

- none of these values may use a `VITE_` prefix;
- `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY` must be the production key for decrypting production tenant credentials and must not be reused from local/test fixtures;
- tenant access tokens are not global Worker variables; they are stored encrypted per tenant/phone in D1 by WA4;
- verify/app secrets are never exposed by status/readiness endpoints.

## 2. Record rollback state before changing Meta

Capture the following in the private deployment/change record, not in Git:

- current production WhatsApp webhook callback URL;
- current verify-token secret reference;
- current application/deployment receiving the callback;
- current Cloudflare route/custom-domain target;
- current production Worker version/deployment identifier;
- current D1 migration/schema version;
- timestamp and operator.

Do not paste access tokens or App Secret into the change record.

## 3. Deploy without switching Meta

1. deploy the tested WA7 Worker release to production;
2. configure production bindings/secrets;
3. apply D1 migrations before allowing WhatsApp production traffic;
4. verify `/health`;
5. verify `/ready` is green;
6. authenticate as a tenant owner/admin and verify WhatsApp onboarding status;
7. confirm the expected tenant has a `connected` WABA/phone and an encrypted credential;
8. verify template listing from the Cloudflare endpoint for the selected phone.

A failure in any item stops the cutover. Fix the deployment first; do not change the Meta callback to make an unready Worker reachable.

## 4. Verify webhook challenge on the final hostname

Before saving the new callback in Meta, validate that the final public endpoint is reachable:

`GET https://<production-host>/api/whatsapp/webhook`

Meta's verification request must succeed only with the configured `WHATSAPP_VERIFY_TOKEN` and must return the challenge as plain text.

A wrong token must return a rejection and must not reveal the expected token.

## 5. Switch the Meta callback

Only after sections 1–4 are green:

1. change the WhatsApp webhook callback to the Cloudflare production endpoint;
2. complete Meta's verification challenge;
3. confirm the WABA remains subscribed to the app;
4. do not change phone/WABA ownership records manually during the same window.

This is the first externally effective WA7 action.

## 6. Controlled smoke test

Use a controlled test conversation belonging to the production tenant.

### Inbound

- [ ] send one new customer message;
- [ ] webhook signature is accepted;
- [ ] tenant is resolved from persisted `phone_number_id`/WABA ownership;
- [ ] exactly one ingress receipt exists;
- [ ] exactly one live chat message exists;
- [ ] retry/replay of the same provider message ID does not duplicate effects;
- [ ] message is tagged as live webhook ingress, not historical import.

### Outbound

- [ ] send one human message through the YuiSync UI/API;
- [ ] the send is associated with the intended tenant/phone;
- [ ] initial lifecycle becomes `submitted`, not optimistic `sent`;
- [ ] Meta `sent`, `delivered` and/or `read` webhook events reconcile the same provider `wamid`;
- [ ] an older/out-of-order status cannot regress a newer status;
- [ ] repeated client idempotency key does not produce a second Graph send.

### Tenant isolation

- [ ] perform the same checks on a second tenant before general multi-tenant release if a second production tenant exists;
- [ ] a phone/WABA owned by tenant B cannot be selected or persisted under tenant A.

## 7. Observation before cleanup

Keep compatibility/rollback code available until the new callback has been stable through controlled traffic.

Watch for:

- webhook signature rejection;
- unknown phone/WABA IDs;
- D1 uniqueness/idempotency conflicts;
- provider status events without matching outbound `wamid`;
- Graph authorization failures;
- repeated retries from Meta;
- unexpected tenant-selection-required errors for tenants with multiple connected phone numbers.

Do not interpret history/coexistence payloads using guessed fields. WA6 remains governed by its ADR.

## 8. Rollback

If live traffic is not healthy:

1. restore the previously recorded Meta callback/application target;
2. restore the previously recorded Cloudflare route/deployment only if the route itself was changed;
3. keep the new D1 records for diagnosis — do not delete live message history to roll back routing;
4. stop new sends through the unhealthy path if delivery certainty is unknown;
5. diagnose using provider message IDs, ingress receipts and delivery receipts;
6. retry the cutover only after the failed readiness condition is understood.

Database rollback is not the first response to a routing problem. The WA4/WA5 schema additions are additive and preserve evidence needed for diagnosis.

## 9. Post-cutover cleanup

After the Cloudflare path is proven stable:

- remove obsolete legacy serverless Meta review/transport code in a separate cleanup PR;
- remove old global WhatsApp access-token/phone/tenant variables from production secret stores if nothing else consumes them;
- retain only the server-only app/verify/encryption configuration required by the Cloudflare runtime;
- document the final Meta callback and Cloudflare route in the private operations record;
- keep the WA6 history gate closed until its independent evidence requirements are met.

## 10. Current boundary

This repository runbook does **not** invent:

- production Cloudflare database IDs;
- a production Worker route;
- DNS records;
- real Meta secrets;
- a coexistence-history payload.

Those values must come from the actual production accounts/configuration at execution time.
