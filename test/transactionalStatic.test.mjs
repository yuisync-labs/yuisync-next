import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('PDV ativo usa exclusivamente o checkout transacional', async () => {
  const source = await read('src/shared/hooks/useSales.js')
  const activeFlow = source.slice(source.indexOf('const createSale ='), source.indexOf('const issueSaleFiscal'))
  assert.match(activeFlow, /checkoutPetshop\(/)
  assert.doesNotMatch(activeFlow, /\.from\(['"]sales['"]\)\.insert/)
  assert.match(activeFlow, /crypto\.randomUUID\(\)/)
})

test('agenda cria reserva e consome beneficio na mesma RPC', async () => {
  const source = await read('src/shared/hooks/useAppointments.js')
  const createFlow = source.slice(source.indexOf('const create = useCallback'), source.indexOf('const update = useCallback'))
  assert.match(createFlow, /book_petshop_appointment_transaction/)
  assert.doesNotMatch(createFlow, /consumeSubscriptionBenefit/)
})

test('taxa MotoDog publica nao e enviada pelo navegador', async () => {
  const source = await read('src/public/pages/PublicBookingPage.jsx')
  assert.doesNotMatch(source, /p_motodog_fee/)
  assert.doesNotMatch(source, /Taxa MotoDog \(R\$\)/)
})

test('migracao protege estoque, idempotencia e conflito de agenda', async () => {
  const migration = await read('supabase/migrations/20260720002000_transactional_operations.sql')
  assert.match(migration, /create table if not exists public\.stock_movements/)
  assert.match(migration, /for update/)
  assert.match(migration, /sales_tenant_idempotency_unique/)
  assert.match(migration, /prevent_appointment_overlap/)
  assert.match(migration, /record_fiscal_queue_failure/)
})

test('reset de estoque preserva itens e vendas historicas', async () => {
  const source = await read('serverless/dashboardApi.ts')
  const resetFlow = source.slice(source.indexOf('async function handleResetStock'), source.indexOf('function normalizeLegacyString'))
  assert.doesNotMatch(resetFlow, /from\(['"]sale_items['"]\)[\s\S]*?\.delete\(/)
  assert.match(resetFlow, /stock_quantity:\s*0/)
})

test('PetBot aplica a RPC transacional de estoque e agenda na cadeia de migracoes', async () => {
  const migration = await read('supabase/migrations/20260720007000_petbot_transaction_rpc.sql')
  const pendingOrders = await read('supabase/migrations/20260723001000_petbot_product_orders_start_pending.sql')
  assert.match(migration, /create or replace function public\.create_petbot_order_transaction/)
  assert.match(migration, /from public\.products[\s\S]*?for update/)
  assert.match(migration, /from public\.appointments[\s\S]*?for update/)
  assert.match(migration, /update public\.products set stock_quantity = stock_quantity - v_quantity/)
  assert.match(migration, /status = 'agendado'/)
  assert.match(pendingOrders, /pg_get_functiondef\('public\.create_petbot_order_transaction\(jsonb\)'::regprocedure\)/)
  assert.match(pendingOrders, /then ''pendente'' else ''agendado''/)
  assert.match(pendingOrders, /grant execute on function public\.create_petbot_order_transaction\(jsonb\) to service_role/)
})

test('smoke test do PetBot valida operacoes reais e sempre descarta os dados', async () => {
  const smoke = await read('supabase/petbot_controlled_smoke_test.sql')
  assert.match(smoke, /^begin;/m)
  assert.match(smoke, /create_petbot_order_transaction/)
  assert.match(smoke, /quantidades fracionadas ainda usam integer/)
  assert.match(smoke, /item\.quantity = 0\.5/)
  assert.match(smoke, /Estoque insuficiente/)
  assert.match(smoke, /confirmacao duplicada movimentou o estoque novamente/)
  assert.match(smoke, /agendamento veterinario nao apareceu corretamente na agenda/)
  assert.match(smoke, /Horario nao esta mais disponivel/)
  assert.match(smoke, /last_petbot_idempotency_key/)
  assert.match(smoke, /rollback;\s*$/i)
  assert.doesNotMatch(smoke, /\bcommit\s*;/i)
})

test('retirada do PetBot fica pendente com pagamento a combinar', async () => {
  const paymentMigration = await read('supabase/migrations/20260723002000_petbot_pickup_payment_to_arrange.sql')
  const constraintMigration = await read('supabase/migrations/20260723003000_sales_payment_to_arrange_constraint.sql')
  const smoke = await read('supabase/petbot_controlled_smoke_test.sql')

  assert.match(paymentMigration, /v_payment_method := ''a_combinar''/)
  assert.match(paymentMigration, /when v_payment_method = ''a_combinar'' then ''a_receber''/)
  assert.match(constraintMigration, /'a_combinar'/)
  assert.match(smoke, /sale\.payment_method = 'a_combinar'/)
  assert.match(smoke, /delivery_order\.status = 'pendente'/)
})

test('estoque e itens vendidos preservam quantidades fracionadas no banco', async () => {
  const migration = await read('supabase/migrations/20260722005000_fractional_inventory_quantities.sql')
  assert.match(migration, /products alter column stock_quantity type numeric\(12,3\)/)
  assert.match(migration, /products alter column min_stock type numeric\(12,3\)/)
  assert.match(migration, /sale_items alter column quantity type numeric\(12,3\)/)
  assert.match(migration, /pg_get_viewdef/)
  assert.match(migration, /vw_critical_stock/)
  assert.match(migration, /notify pgrst, 'reload schema'/)
})

test('PetBot possui um unico escritor de movimento por item vendido', async () => {
  const migration = await read('supabase/migrations/20260722006000_petbot_stock_movement_single_writer.sql')
  const smoke = await read('supabase/petbot_controlled_smoke_test.sql')
  assert.match(migration, /pg_get_functiondef\('public\.create_petbot_order_transaction\(jsonb\)'::regprocedure\)/)
  assert.match(migration, /app\.yuisync_stock_writer/)
  assert.match(migration, /create_pdv_checkout_transaction/)
  assert.match(migration, /create trigger record_petbot_stock_movement/)
  assert.match(smoke, /a RPC e o trigger ainda duplicam a auditoria de estoque/)
  assert.match(smoke, /primeira venda gerou % movimentos de estoque/)
  assert.match(smoke, /v_movement_count_before/)
})

test('smoke veterinario usa a mesma especie efetiva da RPC', async () => {
  const smoke = await read('supabase/petbot_controlled_smoke_test.sql')
  assert.match(smoke, /infer_petbot_service_species\([\s\S]*service\.bot_metadata->>'species',[\s\S]*service\.species_target/)
  assert.match(smoke, /into v_service_id, v_service_price, v_service_species, v_duration/)
  assert.match(smoke, /'species', v_service_species/)
  assert.doesNotMatch(smoke, /lower\(coalesce\(service\.species_target, service\.bot_metadata->>'species'/)
})

test('deploy permanece dentro do limite de funcoes do Vercel Hobby', async () => {
  const apiFiles = await readdir(new URL('api/', root), { recursive: true })
  const serverlessFunctions = apiFiles.filter((path) => path.endsWith('.ts'))
  assert.ok(
    serverlessFunctions.length <= 12,
    `O deploy possui ${serverlessFunctions.length} funcoes serverless; o limite do Hobby e 12.`,
  )
})

test('historico de vendas desambigua o relacionamento com vendedor', async () => {
  const source = await read('src/shared/hooks/useSales.js')
  assert.match(source, /profiles!sales_profile_id_fkey\s*\(/)
  assert.doesNotMatch(source, /['"]profiles\s*\(/)
})

test('seletor da agenda fecha ao escolher cliente e usa busca hibrida limitada', async () => {
  const source = await read('src/modules/petshop/pages/AgendaPage.jsx')
  const clientsSource = await read('src/shared/hooks/useClients.js')
  assert.match(source, /setClientPickerOpen\(false\)/)
  assert.match(source, /useDeferredValue\(petSearch\)/)
  assert.match(source, /\.slice\(0, 8\)/)
  assert.match(source, /searchRequestRef/)
  assert.match(source, /onSearchClients\(query, \{ limit: 20 \}\)/)
  assert.match(clientsSource, /const search = useCallback/)
  assert.match(clientsSource, /\.limit\(limit\)/)
  assert.doesNotMatch(source, /onSearchClients=\{loadPets\}/)
})

test('modo caixa do PDV usa scanner e preserva o checkout transacional', async () => {
  const source = await read('src/modules/petshop/pages/VendasPage.jsx')
  const routerSource = await read('src/router/AppRouter.jsx')
  assert.match(source, /tab === 'caixa'/)
  assert.match(source, /Buscar produto ou ler codigo de barras/)
  assert.match(source, /String\(item\.barcode \|\| ''\)\.trim\(\) === code/)
  assert.match(source, /event\.key !== 'F2'/)
  assert.match(source, /onScan=\{handleScannerSubmit\}/)
  assert.match(source, /cashierProductResults/)
  assert.match(source, /normalizeProductSearch\(product\.name\)\.includes\(query\)/)
  assert.match(source, /onChooseProduct=\{handleChooseCashierProduct\}/)
  assert.match(source, /parseCashierEntry/)
  assert.match(source, /aria-label="Quantidade do produto"/)
  assert.match(source, /value\.match\(\/\^\(\\d\+\)\\s\*\\\*\//)
  assert.match(source, /addToCart\(product, quantity\)/)
  assert.match(source, /quantityInCart \+ quantity > Number\(product\.stock_quantity/)
  assert.match(source, /flex h-full min-h-0 flex-col bg-\[var\(--bg\)\]/)
  assert.match(source, /flex-1 overflow-y-auto px-5 py-4/)
  assert.doesNotMatch(source, /sticky bottom-0 z-20/)
  assert.match(source, /min-h-0 overflow-y-auto p-4/)
  assert.match(source, /onClick=\{handleSell\}/)
  assert.match(source, /modal-overlay theme-petshop-modal/)
  assert.match(source, /yuisync:focus-mode/)
  assert.match(source, /Sair do Modo Caixa/)
  assert.match(source, /tab === 'caixa' \? 'top-full mt-2 slide-in-from-top-2'/)
  assert.match(routerSource, /!focusMode && \(\s*<Sidebar/)
  assert.match(routerSource, /activeModuleId !== 'system' && !focusMode && <SupportWidget/)
})

test('cards de clientes preservam nomes legiveis e acoes separadas', async () => {
  const source = await read('src/modules/petshop/pages/PetsPage.jsx')
  const clientsSource = await read('src/shared/hooks/useClients.js')
  assert.match(source, /function formatPersonName/)
  assert.match(source, /replace\(\/\^\[\\s:;,\.=_-\]\+\//)
  assert.match(source, /line-clamp-2 text-base font-bold leading-snug/)
  assert.match(source, /flex min-h-\[270px\] flex-col/)
  assert.match(source, /mt-auto border-t/)
  assert.match(source, /const matchesSearch = \(!query && !queryDigits\) \|\| matchesText \|\| matchesDigits/)
  assert.match(source, /const CLIENTS_PAGE_SIZE = 60/)
  assert.match(source, /visibleTutorGroups\.map/)
  assert.doesNotMatch(source, /\{filteredPets\.map/)
  assert.match(clientsSource, /fetchAllClientPages/)
  assert.match(clientsSource, /\.range\(from, from \+ CLIENT_PAGE_SIZE - 1\)/)
})

test('ordem impressa usa a largura nativa da Print iD sem forcar altura', async () => {
  const source = await read('src/modules/petshop/pages/OrdensEntregaPage.jsx')
  assert.match(source, /printThermalReceipt\(printWindow\)/)
  assert.match(source, /const width = '80mm'/)
  assert.match(source, /const printableWidth = '64mm'/)
  assert.match(source, /class="receipt"/)
  assert.match(source, /quatro-patas-logo-mono\.png/)
  assert.match(source, /Conferência \/ ordem de entrega/)
  assert.match(source, /<table><thead>/)
  assert.match(source, /Endereço de entrega/)
  assert.match(source, /Endereço do cliente/)
  assert.match(source, /completeClientAddress/)
  assert.match(source, /order\.delivery_reference/)
  assert.match(source, /client\.address/)
  assert.match(source, /client\.neighborhood/)
  assert.match(source, /Referência/)
  assert.match(source, /const address = completeClientAddress\(order\) \|\| orderOriginAddress\(order\)/)
  assert.match(source, /AV CONSTANTINO PINTO, 191/)
  assert.match(source, /\(32\)98520-5279/)
})

test('ordem PetBot persiste e exibe o ponto de referência da entrega', async () => {
  const migration = await read('supabase/migrations/20260723004000_delivery_order_full_address.sql')
  assert.match(migration, /add column if not exists delivery_reference text/)
  assert.match(migration, /p_payload->>''delivery_reference''/)
  assert.match(migration, /delivery_reference = excluded\.delivery_reference/)
  assert.match(migration, /update public\.service_delivery_orders o/)
})

test('todos os comprovantes usam a largura 80mm da Print iD', async () => {
  const receiptFiles = [
    'src/shared/pages/BillingPage.jsx',
    'src/modules/petshop/pages/AgendaPage.jsx',
    'src/modules/petshop/pages/VendasPage.jsx',
  ]

  for (const file of receiptFiles) {
    const source = await read(file)
    assert.match(source, /printThermalReceipt\(printWindow\)/)
    assert.match(source, /@page \{ margin: 0; \}/)
    assert.match(source, /class="receipt"/)
    assert.doesNotMatch(source, /size: 80mm auto/)
    assert.match(source, /width: 80mm/)
  }

  const utility = await read('src/lib/thermalPrint.js')
  assert.match(utility, /Print iD controla avanço e corte pelo próprio driver/)
  assert.doesNotMatch(utility, /@page/)
})

test('importacao legado preserva historico e oculta registros arquivados', async () => {
  const script = await read('scripts/import_legacy_petshop.py')
  const clients = await read('src/shared/hooks/useClients.js')
  assert.match(script, /Soft-delete evita quebrar vendas, estoque e agendamentos legados vinculados/)
  assert.match(script, /BATCH_SIZE = 250/)
  assert.match(script, /repair-product-categories/)
  assert.match(script, /repair-product-units/)
  assert.match(script, /repair-bulk-stock/)
  assert.match(script, /canonical_product_category/)
  assert.match(script, /'active': False/)
  assert.match(script, /'on_conflict': 'barcode'/)
  assert.match(clients, /\.eq\('active', true\)/)
})

test('detalhes do cliente mostram endereco completo e complemento', async () => {
  const source = await read('src/modules/petshop/pages/PetsPage.jsx')
  const clients = await read('src/shared/hooks/useClients.js')
  assert.match(source, /Endereco<\/p>/)
  assert.match(source, /pet\.owner_address/)
  assert.match(source, /pet\.address_complement/)
  assert.match(source, /pet\.owner_neighborhood/)
  assert.match(source, />Complemento<\/p>/)
  assert.doesNotMatch(source, /pet\.address_number && `Nº \$\{pet\.address_number\}`/)
  assert.match(clients, /address_complement: c\.details\?\.address_complement/)
  assert.doesNotMatch(source, /Numero \/ referencia/)
})

test('estoque permite unidades e fracao para produtos por peso', async () => {
  const source = await read('src/modules/petshop/pages/EstoquePage.jsx')
  assert.match(source, /Quilograma \(KG\)/)
  assert.match(source, /MIL \(conforme planilha\)/)
  assert.match(source, /step=\{form\.unit === 'KG' \? '0\.001' : '1'\}/)
  assert.match(source, /formatStockQuantity/)
})

test('modo noturno e persistido e tem alternancia no menu', async () => {
  const router = await read('src/router/AppRouter.jsx')
  const sidebar = await read('src/components/Sidebar.jsx')
  const styles = await read('src/index.css')
  assert.match(router, /@yuisync-color-mode/)
  assert.match(router, /theme-\$\{activeModuleId\} \$\{darkMode \? 'theme-dark' : ''\}/)
  assert.match(sidebar, /aria-label=\{darkMode \? 'Ativar modo claro' : 'Ativar modo noturno'\}/)
  assert.equal((sidebar.match(/onClick=\{onToggleDarkMode\}/g) || []).length, 2)
  assert.match(styles, /\.theme-petshop\.theme-dark/)
  assert.match(styles, /#38BDF8/)
})

test('catalogo comercial de servicos sincroniza com a agenda transacional', async () => {
  const migration = await read('supabase/migrations/20260721003500_sync_service_products_catalog.sql')
  assert.match(migration, /add column if not exists source_product_id/)
  assert.match(migration, /create trigger trg_sync_product_service_catalog/)
  assert.match(migration, /from public\.products product/)
  assert.match(migration, /'catalog_' \|\| replace\(product\.id::text, '-', ''\)/)
  assert.match(migration, /default_price = excluded\.default_price/)
})

test('falha generica do agente permanece recuperavel sem retornar ao fluxo hardcoded', async () => {
  const source = await read('server/lib/chat.js')
  const webhook = await read('serverless/whatsappWebhook.ts')
  const grounding = await read('server/lib/petbotGrounding.js')
  const catchStart = source.indexOf("logger.warn('PetBot agent failed'")
  const segment = source.slice(catchStart)
  assert.match(segment, /respondWithPetbotRecoverableFailure/)
  assert.match(source, /recoverable_agent_error/)
  assert.doesNotMatch(segment, /status:\s*'human'/)
  assert.doesNotMatch(source, /runPetbotGuard/)
  assert.doesNotMatch(webhook, /runPetbotGuard/)
  assert.match(source, /mergePetshopServiceCatalogs/)
  assert.match(source, /validatePetbotOperationalReply/)
  assert.match(grounding, /situação de estoque sem consulta ao catálogo/)
  assert.match(grounding, /disponibilidade de agenda sem consulta/)
})

test('PetBot v3 confirma pedidos de forma idempotente e usa configuracao real da loja', async () => {
  const migration = await read('supabase/migrations/20260721006000_petbot_agent_v3_runtime.sql')

  assert.match(migration, /create table if not exists public\.petbot_order_commits/)
  assert.match(migration, /primary key \(tenant_id, idempotency_key\)/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /status = 'completed'/)
  assert.doesNotMatch(migration, /last_sale_id is not null/)
  assert.match(migration, /petbot_business_hours/)
  assert.match(migration, /petbot_booking_capacity/)
  assert.match(migration, /pet_transport_options/)
  assert.match(migration, /p\.species_target/)
  assert.match(migration, /from public\.products/)
  assert.match(migration, /from public\.petshop_services/)
  assert.doesNotMatch(migration, /service_transport_fee'\)::numeric/)
  assert.match(migration, /revoke all on function public\.create_petbot_order_transaction\(jsonb\) from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.create_petbot_order_transaction\(jsonb\) to service_role/)
})

test('RPC do PetBot inicializa transporte quando o cliente leva o pet', async () => {
  const canonical = await read('supabase/migrations/20260721006000_petbot_agent_v3_runtime.sql')
  const forward = await read('supabase/migrations/20260722002000_petbot_initialize_transport_record.sql')
  const initialization = /select null::text as id, null::text as label, 0::numeric as fee\s+into v_transport_option/

  assert.match(canonical, initialization)
  assert.match(forward, /pg_get_functiondef\('public\.create_petbot_order_transaction\(jsonb\)'::regprocedure\)/)
  assert.match(forward, /select null::text as id, null::text as label, 0::numeric as fee\\n  into v_transport_option/)
  assert.match(forward, /v_definition !~\* v_anchor_pattern/)
  assert.match(forward, /regexp_replace\(v_definition, v_anchor_pattern, v_replacement, 'i'\)/)
  assert.match(forward, /grant execute on function public\.create_petbot_order_transaction\(jsonb\) to service_role/)
})

test('RPC concilia a ordem criada pelo trigger legado sem duplicar sale_id', async () => {
  const canonical = await read('supabase/migrations/20260721006000_petbot_agent_v3_runtime.sql')
  const forward = await read('supabase/migrations/20260722003000_petbot_service_order_upsert.sql')
  const legacy = await read('database/petshop_advanced_features.sql')

  assert.match(legacy, /trg_sync_service_order_for_whatsapp_sale[\s\S]*after insert on public\.sales/)
  assert.match(canonical, /insert into public\.service_delivery_orders[\s\S]*on conflict \(sale_id\) where sale_id is not null do update/)
  assert.match(canonical, /returning id into v_order_id/)
  assert.match(forward, /pg_get_functiondef\('public\.create_petbot_order_transaction\(jsonb\)'::regprocedure\)/)
  assert.match(forward, /v_definition ~\* v_conflict_pattern/)
  assert.match(forward, /regexp_replace\(v_definition, v_return_pattern, v_replacement, 'i'\)/)
})

test('contexto persistente do agente usa JSONB e converte dados legados com seguranca', async () => {
  const schema = await read('database/DATABASE.sql')
  const migration = await read('supabase/migrations/20260722004000_chat_session_context_jsonb.sql')

  assert.match(schema, /context JSONB NOT NULL DEFAULT '\{\}'::JSONB/)
  assert.match(migration, /create or replace function public\._yuisync_safe_chat_context\(p_value text\)/)
  assert.match(migration, /if jsonb_typeof\(v_json\) = 'object'/)
  assert.match(migration, /return jsonb_build_object\('legacy_value', v_json\)/)
  assert.match(migration, /return jsonb_build_object\('legacy_text', p_value\)/)
  assert.match(migration, /from information_schema\.columns as column_info/)
  assert.doesNotMatch(migration, /information_schema\.columns column/)
  assert.match(migration, /alter column context type jsonb\s+using public\._yuisync_safe_chat_context\(context::text\)/)
  assert.match(migration, /alter column context set default '\{\}'::jsonb/)
  assert.match(migration, /alter column context set not null/)
  assert.match(migration, /drop function public\._yuisync_safe_chat_context\(text\)/)
})

test('classificacao PetBot preenche racas comuns por pelagem sem sobrescrever ajustes manuais', async () => {
  const migration = await read('supabase/migrations/20260721004000_petbot_common_breed_classification.sql')
  const catalog = await read('shared/petbotBreedCatalog.js')
  const stockPage = await read('src/modules/petshop/pages/EstoquePage.jsx')
  const agent = await read('server/lib/petbotAgent.js')

  assert.match(migration, /yuisync_common_breed_presets_v1/)
  assert.match(migration, /jsonb_array_length\(product\.bot_metadata->'breed'\) = 0/)
  assert.match(migration, /'all_breeds', resolved\.resolved_coat_type = 'todas'/)
  assert.match(catalog, /canonical: 'Spitz Alemão'.*coat_type: 'duplo'/)
  assert.match(catalog, /canonical: 'Shih Tzu'.*coat_type: 'longo'/)
  assert.match(catalog, /canonical: 'Dachshund'.*ambiguous|AMBIGUOUS_BREEDS/s)
  assert.match(stockPage, /Preencher racas comuns/)
  assert.match(stockPage, /Pelagem do servico/)
  assert.match(agent, /inferredCoatTypeForBreed/)
  assert.match(agent, /serviceMatchesBreedPreset/)
})


test('classificacao exclusiva armazena uma unica grafia canonica por raca', async () => {
  const migration = await read('supabase/migrations/20260721005000_petbot_exclusive_breed_classification.sql')
  const catalog = await read('shared/petbotBreedCatalog.js')

  assert.match(migration, /yuisync_exclusive_breed_presets_v2/)
  assert.match(migration, /classification_version', 3/)
  assert.match(migration, /having count\(distinct coat_type\) > 1/)
  assert.match(migration, /'longo'.*\["shih tzu", "yorkshire terrier"/s)
  assert.doesNotMatch(migration, /"shihtzu"/)
  assert.doesNotMatch(migration, /"shitzu"/)
  assert.match(catalog, /commonCanonicalBreedsForCoatType/)
  assert.match(catalog, /classification_source: CLASSIFICATION_SOURCE/)
})


test('PetBot v3 movimenta estoque e consome beneficio de plano na mesma transacao', async () => {
  const migration = await read('supabase/migrations/20260721006000_petbot_agent_v3_runtime.sql')
  assert.match(migration, /insert into public\.stock_movements/)
  assert.match(migration, /'Venda PetBot'/)
  assert.match(migration, /from public\.client_subscriptions subscription/)
  assert.match(migration, /for update of subscription/)
  assert.match(migration, /services_used = jsonb_set/)
  assert.match(migration, /subscription_benefit_used = v_subscription_benefit_used/)
  assert.match(migration, /'subscription_plan_name', v_subscription_plan_name/)
})


test('catalogo de servicos normaliza especie e protege novos cadastros', async () => {
  const migration = await read('supabase/migrations/20260721007000_petbot_service_species_priority.sql')
  const agent = await read('server/lib/petbotAgent.js')

  assert.match(migration, /infer_petbot_service_species/)
  assert.match(migration, /trg_apply_petbot_service_species_metadata/)
  assert.match(migration, /return 'cat'/)
  assert.match(migration, /return 'dog'/)
  assert.match(agent, /inferServiceSpecies/)
  assert.match(agent, /isUniversalSmallDogBathService/)
  assert.match(agent, /normalizedWeight <= 10/)
})


test('agendamento PetBot permanece a receber e aceita origem WhatsApp', async () => {
  const migration = await read('supabase/migrations/20260722001000_petbot_service_booking_flow.sql')
  assert.match(migration, /appointments_source_check[\s\S]*source ~ '\^\[a-z0-9\]/)
  assert.match(migration, /fulfillment_type = 'servico'/)
  assert.match(migration, /payment_method := null/)
  assert.match(migration, /payment_status := 'a_receber'/)
  assert.match(migration, /service_delivery_orders/)
  assert.match(migration, /create trigger normalize_petbot_service_booking_sale\s+before insert on public\.sales/)
  assert.match(migration, /create trigger normalize_petbot_service_delivery_payment\s+before insert on public\.service_delivery_orders/)
  assert.doesNotMatch(migration, /normalize_petbot_service_booking_sale\s+before insert or update/)
})

test('integridade do banho unifica catalogo, peso e retorno transacional', async () => {
  const migration = await read('supabase/migrations/20260722007000_petbot_bath_catalog_integrity.sql')
  const suite = await read('supabase/petbot_bath_booking_50_case_test.sql')
  const cleanup = await read('supabase/cleanup_petbot_bath_test_artifacts.sql')
  const management = await read('scripts/supabase-management.mjs')
  const stockPage = await read('src/modules/petshop/pages/EstoquePage.jsx')
  const labels = [...suite.matchAll(/\[(\d{2})\/50\]/g)].map((match) => Number(match[1]))

  assert.match(migration, /is_petbot_service_catalog_product/)
  assert.match(migration, /infer_petbot_service_weight_metadata/)
  assert.match(migration, /returning id, payment_status into v_sale_id, v_payment_status/)
  assert.match(migration, /pg_get_functiondef\('public\.create_petbot_order_transaction\(jsonb\)'::regprocedure\)/)
  assert.match(migration, /set local lock_timeout = '10s'/)
  assert.doesNotMatch(migration, /drop trigger if exists trg_apply_petbot_service_species_metadata/)
  assert.match(migration, /Trigger de metadados do catalogo nao encontrado/)
  assert.match(migration, /banho \(a \)\?seco/)
  assert.match(migration, /pacote\.\*banho\|banho\.\*pacote/)
  assert.match(stockPage, /if \(\/banheira\|banho \(\?:a \)\?seco/)
  assert.match(stockPage, /service_group: productType === 'servico'[\s\S]*?: null,/)
  assert.equal(labels.length, 50)
  assert.deepEqual([...new Set(labels)].sort((a, b) => a - b), Array.from({ length: 50 }, (_, index) => index + 1))
  assert.match(suite, /last_payment_status' = 'a_receber'/)
  assert.match(suite, /produto banho a seco nao pode ser agendado como servico/)
  assert.match(suite, /^--[\s\S]*?\nbegin;/)
  assert.match(suite, /rollback;\s*$/)
  assert.match(cleanup, /idempotency_key like 'bath-50-%'/)
  assert.match(cleanup, /pet_name like '__PETBOT_BATH_50_%'/)
  assert.match(cleanup, /commit;/)
  assert.match(management, /\(\?:commit\|rollback\)/)
})

test('correcao do endereco mantem colunas e VALUES da ordem alinhados', async () => {
  const original = await read('supabase/migrations/20260723004000_delivery_order_full_address.sql')
  const forward = await read('supabase/migrations/20260723005000_fix_petbot_order_delivery_reference_values.sql')

  assert.match(original, /regexp_replace\([\s\S]*service_transport_city[\s\S]*service_transport_reference/)
  assert.doesNotMatch(original, /if v_definition !~ 'service_transport_reference' then/)
  assert.match(forward, /insert into public\.service_delivery_orders/)
  assert.match(forward, /delivery_city,\\s\+delivery_reference,\\s\+contact_phone/)
  assert.match(forward, /p_payload->>''delivery_reference''/)
  assert.match(forward, /p_payload->>''service_transport_reference''/)
  assert.match(forward, /Nao foi localizado o ponto de VALUES para delivery_reference/)
  assert.match(forward, /notify pgrst, 'reload schema'/)
})
