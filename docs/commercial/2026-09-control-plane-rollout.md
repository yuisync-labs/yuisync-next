# YuiSync commercial control plane — rollout 2026-09

## Decision record

This document is the canonical rollout plan for the first versioned YuiSync SaaS catalog.
It is intentionally separate from plans/packages that each tenant sells to its own customers.

### Commercial catalog v1

| Capability | Essencial | Pro | Business |
| --- | ---: | ---: | ---: |
| Monthly price | R$ 149 | R$ 279 | R$ 449 |
| Units | 1 | 1 | 1 |
| Active users | 3 | 10 | 20 |
| Agenda / clients / PDV / finance / inventory | yes | yes | yes |
| Full CRM | no | yes | yes |
| Advanced automations | no | yes | yes |
| Official WhatsApp | no | yes | yes |
| Multi-agent WhatsApp | no | yes | yes |
| Yui internal copilot | no | yes | yes |
| Autonomous Yui on WhatsApp | no | no | yes |
| Included autonomous Yui messages / billing period | 0 | 0 | **1,000** |
| Manual campaigns | no | yes | yes |
| Automatic campaigns | no | no | yes |
| Fiscal | no | no | yes |
| API / webhooks | no | no | yes |
| Advanced audit | no | no | yes |

The previous concept of **700 AI attendances/conversations is retired**. The Business allowance is message-based because it is deterministic, auditable and directly correlated with provider usage.

## Definition of one included Yui message

One unit is consumed when a unique outbound WhatsApp message with `actor_type = assistant` is accepted for provider submission.

Rules:

1. Human and system messages do not consume the Yui allowance.
2. The usage event is keyed by the internal outbound message id; an idempotent retry cannot consume twice.
3. The unit is reserved before the Meta request so concurrent requests cannot intentionally bypass the hard quota.
4. If the provider request fails before submission, the reserved unit is released.
5. Once Meta accepts/submits the message, the unit remains consumed even if a later delivery receipt reports a recipient-side delivery failure. The platform already incurred the AI/provider operation at that point and the outbound was accepted by Meta.
6. Legacy tenants without an explicit SaaS subscription are temporarily grandfathered during rollout. They are not silently forced into Essencial.
7. New tenants receive `essential@2026-09` automatically and are therefore enforced from creation.

## D1 control plane

The control plane is versioned rather than hard-coded as `if (plan === ...)` across endpoints.

Core tables:

- `saas_plans`
- `saas_plan_versions`
- `saas_plan_entitlements`
- `tenant_subscriptions`
- `tenant_entitlement_overrides`
- `usage_periods`
- `usage_events`
- `usage_counters`
- `billing_accounts`
- `provider_webhook_events`
- `billing_events`
- `tenant_cost_snapshots`

Plan versions are immutable commercial contracts. A future price/allowance change must create a new plan version instead of rewriting the 2026-09 version.

## Enforcement boundaries

The Edge dispatcher applies a centralized commercial guard before protected route handlers.

Initial hard gates in this rollout:

- managed active users (`users.max`)
- official WhatsApp (`whatsapp.official`)
- fiscal (`fiscal.enabled`)
- autonomous Yui outbound (`yui.ai_outbound_messages`, which also implies Business-only autonomous usage)

Additional capabilities should use the same entitlement service instead of adding plan-name checks.

## Usage visibility

`GET /api/commercial/plans` exposes the active commercial catalog.

`GET /api/commercial/subscription?tenant_id=...` exposes, for an authorized tenant member:

- current plan/version and price
- billing period
- compatibility-mode status
- effective entitlements and overrides
- included, consumed and remaining Yui autonomous messages

This API is the backend contract for the future **Plano e uso** screen.

## Billing and provider events

The schema is provider-neutral on purpose. `tenant_subscriptions` and `billing_accounts` can be connected to Asaas, Stripe or another gateway without changing feature enforcement.

Provider webhooks must use `provider_webhook_events` as the idempotency inbox before mutating subscription state. Required production rules:

- verify provider signature before persistence/mutation
- unique provider event id
- safe replay
- explicit processing state
- billing audit event for every financial state transition
- no direct entitlement mutation from unverified webhook payloads

Gateway selection, credentials and provider-specific webhook implementation are a separate deployment gate because they require external commercial/account configuration.

## Meta and campaigns

Meta usage must remain distinct from the 1,000 Yui messages. The next metering adapters must classify delivered outbound events into service, utility, authentication and marketing categories.

Marketing campaigns must be billed from delivered billable messages rather than attempted sends. Campaign usage should create its own usage/billing events and must never decrement `yui.ai_outbound_messages` merely because Yui generated campaign copy.

The commercial hypothesis remains that marketing delivery is a pass-through/usage product with margin; pricing should be stored as a versioned billing rule, not embedded in campaign code.

## FinOps

`tenant_cost_snapshots` is the aggregation target for per-tenant technical COGS:

- OpenAI
- Meta
- Cloudflare
- database/storage
- payment gateway
- other attributable variable infrastructure
- revenue

Operational alerts to add before large-scale acquisition:

- tenant technical COGS > 25% of subscription revenue
- tenant technical COGS > 40% of subscription revenue
- abnormal Yui/Meta/runtime growth
- retry/loop spikes
- unusual Durable Object or queue usage

## Rollout order

1. Apply D1 migrations 0032 and 0033.
2. Deploy catalog, entitlement service, guard and commercial read API.
3. Validate legacy tenants remain in compatibility mode.
4. Assign explicit plan versions to existing paying/test tenants one by one.
5. Validate user/WhatsApp/fiscal gates for each plan.
6. Enable autonomous Yui only on Business and verify 1,000-message hard cap plus idempotency/failure release.
7. Connect the selected billing gateway using the provider webhook inbox.
8. Build the customer `Plano e uso` UI over `/api/commercial/subscription`.
9. Add Meta category metering and campaign billing.
10. Ingest real Cloudflare/OpenAI/Meta/gateway cost snapshots and activate margin alerts.
11. Run tenant isolation, retry/replay, agenda double-booking and load certification before broad acquisition.

## Release gates

The commercial control plane is ready to merge only when:

- D1 migration tests pass from a clean database and upgrade paths
- Business resolves to exactly 1,000 autonomous Yui outbound messages
- Pro and Essencial cannot consume autonomous Yui quota
- duplicate usage event does not increment consumption
- quota overflow is rejected before provider submission
- failed provider submission releases the reservation
- new tenants receive Essencial automatically
- existing tenants without subscription remain operational in compatibility mode
- protected route tests continue passing
- repository typecheck/test/build workflows are green

The YuiSync commercial launch is complete only after the external gateway, customer subscription UI, Meta campaign metering and FinOps ingestion are also production-ready. Those are explicit follow-up gates, not hidden work inside this migration.
