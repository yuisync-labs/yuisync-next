# PetShop tab → database integration audit

Date: 2026-08-18  
Scope: active `petshop` navigation from `src/config/modules.jsx`, traced from page/component to active hook/command/API and then to the Cloudflare Worker/D1 persistence boundary.

## Classification

- **PASS** — active path reaches an existing API/table/view and no data-integrity mismatch was found in this audit.
- **FIXED #64** — an executable integration/integrity defect was found and corrected in PR #64.
- **COMPAT DEBT** — behavior is backed by D1, but some browser code still goes through the ratcheted Supabase-compatible facade. This is migration debt, not evidence of missing persistence.
- **UI-ONLY** — current screen is presentation/local-state only and must not be described as persisted functionality.
- **EXTERNAL BOUNDARY** — internal code/persistence exists, while a real external provider/cutover is intentionally a separate release concern.

The compatibility facade is not treated as a failure by itself. A failure requires a concrete mismatch such as a nonexistent/discarded field, a missing active endpoint, a divergent source of truth, or a critical mutation that was not atomic/server protected.

## Matrix

| Tab | Active entry | Active data path | Canonical persistence/source | Result | Evidence / notes |
|---|---|---|---|---|---|
| Dashboard | `DashboardPage` + `DashboardServiceKpiEnhancer` | analytics + appointments + sales + products + chat reads | D1 operational/catalog/chat tables and compatibility views | **PASS / COMPAT DEBT** | No new executable mismatch found. Reads remain partly on the compatibility surface and are covered by the frontend ratchet. |
| Agenda | `AgendaPackageIntegratedPage` + enhancers | `useAppointments` + appointment command/billing presentation | `appointments`, `appointment_services`, package allocation/financial tables | **PASS** | Package state is derived from persisted billing/allocation semantics, not DOM or discounted price. Covered by appointment command/reopen/financial/package regression suites. |
| Vendas / PDV | `VendasPage` | `useSales.createSale` → native checkout API for transactional checkout | `sales`, `sale_items`, `payments`, `payment_splits`, inventory/financial effects | **PASS** | Native checkout is idempotent and covered by `checkoutD1Integration.test.ts` / checkout route tests. Legacy read/report paths remain ratcheted compatibility debt. |
| Ordens / Entrega | `OrdensBanhoTosaIntegratedPage` → `OrdensEntregaPage` | `usePetshopAdvanced` + delivery/order operations + checkout panel | `service_delivery_orders`, `appointments`, `sales`, client/product projections | **PASS / COMPAT DEBT** | Active screen resolves orders from persisted operational records. No missing column/write loss found in the audited path. |
| Atendimento WhatsApp | `ChatPage` | `useChat` + chat compatibility queries; native WhatsApp APIs for Meta surfaces | `chat_threads`, `chat_messages`, operation state; WhatsApp v26-v28 tables | **FIXED #64 / EXTERNAL BOUNDARY** | Schema v30 adds the dashboard fields that were previously discarded, maps legacy `bot/human` and channel values to canonical CHECK-safe values, projects message metadata/tokens/turn version, and adds guarded maintenance. Luna `/chat/respond` execution and the real Meta production cutover remain separate workstreams and are not claimed here. |
| Crescimento CRM | `GrowthPage` | `usePetshopGrowth` | `petshop_growth_*`, campaign logs, executive daily view | **PASS / COMPAT DEBT** | D1 schema includes growth settings/leads/bookings/no-show/report-card/portal data and executive projection. Browser facade debt remains frozen by ratchet. |
| Clientes & Pets | `PetsPage` + history enhancer | clients/pets hooks + advanced subscription helpers | `clients`, `pets`, `client_subscriptions`, package ledger/allocation tables | **FIXED #64** | Old subscription editing path could treat total usage as base usage and duplicate consumption when allocations existed. It now uses native plan commands/canonical usage semantics. |
| Fidelidade | `FidelidadePage` | loyalty helpers from PetShop advanced hook | `loyalty_settings`, `loyalty_points` | **PASS / COMPAT DEBT** | Persistence exists in D1; no new schema/write mismatch found. |
| Controle de Caixa | `CaixaPage` | `cashRegisterOperations` | `cash_register`, sales/payment projections | **FIXED #64** | Schema v30 adds D1 insert/reopen guards so two open registers cannot be created concurrently in the same tenant/module. Compat API maps the conflict to stable 409. |
| Relatórios | `PetshopReportsPage` | appointment/finance/sales/client/chat report hooks + team/service snapshot | operational D1 tables and compatibility views | **PASS / COMPAT DEBT** | Report reads resolve to persisted operational data; no new field/write mismatch found. Read migration debt remains. |
| Planos | `PlanosResponsivePage` / native Planos page | `useCatalogPlans` + `planCommands` + native plans API | `subscription_plans`, `client_subscriptions`, `subscription_benefit_allocations` | **FIXED #64 / PASS** | v29 makes base ledger + allocations authoritative; `services_used_json` is a projection. Native reads expose reserved/consumed. Capacity conflicts fail closed. |
| Financeiro / Notas | `BillingPage` | `useFinance` + fiscal API helpers | finance/payment/invoice tables + fiscal foundation tables | **PASS / EXTERNAL BOUNDARY** | D1 integration exists. Real fiscal authorization/homologation remains a separate launch workstream; this audit does not claim tax production certification. |
| Estoque | `EstoquePage` | `useProducts` → `adjustInventoryCommand` → native inventory endpoint | `catalog_products`, `inventory_balances`, `inventory_movements` | **FIXED #64** | Removed read→absolute-write race. Product metadata can no longer overwrite `on_hand`; manual/XML entries use atomic delta movements with idempotency and reservation guards. CI ratchet locks the boundary. |
| Serviços | `ServicosPage` | `usePetshopServices` / native service API | `services` + service-rule/config tables | **PASS** | Existing native tenant-scoped service boundary persists pricing/weight/config rules. Exact weight boundaries are regression tested. |
| Campanhas | `CampanhasPage` | component-local state/presentation | none for the active screen | **UI-ONLY** | The active page inspected does not persist campaign creation/edits. D1 has `petshop_campaign_logs`, but the current screen must not be represented as a complete persisted campaign manager. |
| Usuários & Cargos | `UsersPage` | Auth context managed-user commands | Better Auth AUTH_DB + `identity_principals` / `tenant_memberships` | **PASS** | Managed users are tenant authorized via native Worker APIs. Create/edit/activation capability was migrated earlier; no new mismatch found here. |
| Equipe & Comissões | `EquipePage` | team snapshot/settings + commission/package operations | staff/profile projections, `commission_rules`, appointment/service financial snapshots | **PASS / COMPAT DEBT** | Operational commission state is persisted; no new executable mismatch found. Some reads/mutations remain on the frozen compatibility surface. |
| Meta / WhatsApp | `MetaWhatsappPage` | native review/onboarding/template/connection APIs | `whatsapp_waba_accounts`, `whatsapp_phone_connections`, credentials/outbound/delivery tables | **PASS / EXTERNAL BOUNDARY** | WA1-WA7 code integration exists. Real Meta callback/phone-number production cutover is intentionally separate and was not changed by #64. |
| Configurações | `SettingsIntegratedPage` | tenant/module settings facade + settings refresh | `tenant_module_settings`, module settings extensions | **PASS / COMPAT DEBT** | DOM use in the integrated page is presentation/portal placement only; operational state is not reconstructed from DOM. |
| Logs | `LogsPage` | `system_update_logs` compatibility read/insert + static project milestones | `system_update_logs` plus static changelog overlay | **PASS / COMPAT DEBT** | Manual logs persist in D1. The page also intentionally merges a static milestone list, so not every visible entry is a DB row. |

## Verified defects fixed by PR #64

### 1. Package usage ledger divergence

The package ledger now has one canonical accounting model:

- `client_subscriptions.benefit_ledger_base_used_json` = manual/base usage;
- `subscription_benefit_allocations` = appointment reservations/consumption;
- `services_used_json` = D1-maintained projection of the two sources above.

Triggers keep the projection synchronized, prevent base usage from consuming capacity already reserved by appointments, create a consumed allocation when a late standalone appointment becomes a package benefit, and repair legacy consumed service rows during migration. The Planos/UI path receives explicit consumed/reserved values instead of reverse-engineering usage from price or clamping an invalid request.

### 2. Clients & Pets subscription bypass

The Clients & Pets advanced hook previously retained an older subscription write path. Editing/cancelling from that screen could feed total usage back into a field treated as base usage, duplicating consumed allocations. The active path now shares the native plan commands and the same ledger semantics as Planos.

### 3. Inventory concurrency and stale-snapshot overwrite

Two defects were found:

1. manual adjustment did `SELECT stock_quantity` then absolute `UPDATE`, allowing a lost update under concurrency;
2. any product metadata update also upserted `inventory_balances.on_hand_milliunits`, so a stale product object could restore stock consumed by checkout.

The native inventory command now applies deltas at the D1 boundary, records an `inventory_movements` row, uses operation-key idempotency, increments balance version, and refuses to go below reserved stock. Existing product writes through the compatibility facade are forbidden from directly changing `stock_quantity`.

### 4. Missing destructive maintenance endpoints

The active Chat/Estoque screens called `/api/admin/maintenance/reset-chat` and `/reset-stock`, but the Cloudflare Worker had no dispatcher handler. Native handlers now exist and preserve the original safety intent:

- configured `MAINTENANCE_TEST_TENANT_ID` must exactly match;
- Better Auth session is required;
- active tenant access is required;
- user must be a global admin in `profiles`;
- chat reset deletes operation checkpoints/effects before chat threads/messages to respect D1 foreign keys;
- stock reset refuses any scope with reservations and records auditable adjustment movements.

These routes are test-tenant maintenance tools, not a general production reset capability.

### 5. Chat UI ↔ D1 model mismatch

Before schema v30, active Chat UI values could violate physical D1 CHECK constraints (`bot/human`, `instagram/website/interno`) and several UI fields were not persisted/projected. v30 adds the required chat thread fields and rebuilds compatibility views/normalizers so the legacy UI round-trips safely against canonical D1 values.

### 6. Duplicate open cash register race

Application code checked for an open register before inserting, but D1 had no invariant preventing two simultaneous opens. v30 adds insert/reopen triggers that abort with `CASH_REGISTER_ALREADY_OPEN`, and the compatibility API exposes this as a 409 conflict.

## Executable evidence

The critical findings above are covered by, among others:

- `apps/edge-api/test/packageUsageLedgerV29.test.ts`
- `apps/edge-api/test/packageReconciliationIntegration.test.ts`
- `apps/edge-api/test/appointmentCommandIntegration.test.ts`
- `apps/edge-api/test/appointmentReopenIntegration.test.ts`
- `apps/edge-api/test/appointmentFinancialReopenIntegration.test.ts`
- `apps/edge-api/test/checkoutD1Integration.test.ts`
- `apps/edge-api/test/inventoryAdjustment.test.ts`
- `apps/edge-api/test/adminMaintenance.test.ts`
- `apps/edge-api/test/activeTabIntegrationV30.test.ts`
- `apps/edge-api/test/d1MigrationUpgradeMatrix.test.ts`
- `apps/edge-api/test/health.test.ts`
- WhatsApp adapter/onboarding/outbound/delivery Workerd tests
- managed-user / tenant-authorization tests
- `scripts/check-inventory-write-boundary.mjs`
- frontend compatibility ratchet.

## Schema / readiness consequence

PR #64 advances the main D1 schema to **v30**. `/ready` requires version 30 **and** the structural package-ledger, active-tab, and WhatsApp capabilities; metadata alone is insufficient.

The upgrade matrix exercises recent snapshots through v30. Production is not migrated by this PR and must remain on its existing release until a separate exact-SHA staging certification and authorized promotion is performed.

## Remaining migration debt that is not a #64 failure

The frontend compatibility facade remains intentionally present and ratcheted. This PR reduces its `.from()` ceiling; future work should continue migrating high-value reads/mutations without allowing any per-file increase or new-file compatibility debt.

Two boundaries are intentionally outside this database-integration audit:

1. Luna/dashboard response execution (`/api/chat/respond`) — Luna is a separate tested workstream and is not declared missing here.
2. Real Meta and fiscal production cutovers — code/storage integration does not substitute for provider/tax production authorization.
