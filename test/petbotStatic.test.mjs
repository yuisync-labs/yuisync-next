import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('webhook da Vercel agrupa mensagens fragmentadas com debounce curto por padrao', () => {
  const webhook = read('serverless/whatsappWebhook.ts')
  assert.match(webhook, /DEFAULT_WHATSAPP_REPLY_DEBOUNCE_MS = 1_000/)
  assert.match(webhook, /MAX_BLOCKING_WHATSAPP_REPLY_DEBOUNCE_MS = 1_500/)
})

test('lista de chats nao recarrega em todo insert global de mensagens', () => {
  const hook = read('src/shared/hooks/useChat.js')
  const sessionsSubscription = hook.slice(hook.indexOf("channel('chat-sessions-list')"))
  assert.doesNotMatch(sessionsSubscription, /table:\s*'chat_messages'/)
})

test('pedido PetBot usa uma unica RPC transacional compartilhada por painel e WhatsApp', () => {
  const localChat = read('server/lib/chat.js')
  const webhook = read('serverless/whatsappWebhook.ts')
  const migration = read('supabase/migrations/20260721006000_petbot_agent_v3_runtime.sql')

  assert.match(localChat, /createConfirmedPetshopOrderViaRpc/)
  assert.match(webhook, /respondToChatMessage\(supabase as any, session\.id, runtimeMessage/)
  assert.doesNotMatch(webhook, /createConfirmedPetshopOrderViaRpc/)
  assert.match(migration, /create or replace function public\.create_petbot_order_transaction/)
  assert.match(migration, /if v_order_type = 'produto' then[\s\S]*insert into public\.sale_items/)
  assert.match(localChat, /pet_name: cleanText\(args\.pet_name\)/)
  assert.match(migration, /insert into public\.pets/)
  assert.match(migration, /pet_id = v_pet_id/)
  assert.match(migration, /then 'banho_e_tosa'/)
  assert.match(migration, /then 'consulta'/)
})

test('resposta do PetBot so e salva depois do estado autonomo persistir', () => {
  const localChat = read('server/lib/chat.js')
  const webhook = read('serverless/whatsappWebhook.ts')

  const localPersistIndex = localChat.indexOf('const { data: updatedSession')
  const localReplyIndex = localChat.indexOf('const { data: savedReply', localPersistIndex)
  assert.ok(localPersistIndex > -1)
  assert.ok(localReplyIndex > -1)
  assert.ok(localPersistIndex < localReplyIndex)
  assert.match(localChat, /petbot_agent: \{/)
  assert.match(localChat, /facts: serviceFacts/)
  assert.match(localChat, /hasPetbotState\(updatedSession\.context\)/)
  assert.match(localChat, /recoverPetbotContextFromHistory/)

  assert.match(webhook, /respondToChatMessage\(supabase as any, session\.id, runtimeMessage/)
  assert.match(webhook, /skipUserPersistence: true/)
  assert.doesNotMatch(webhook, /runPetbotGuard/)
})

test('primeira resposta do PetBot recebe a apresentação determinística da Luna', () => {
  const localChat = read('server/lib/chat.js')
  const grounding = read('server/lib/petbotGrounding.js')
  assert.match(localChat, /prependPetbotConversationOpening\(\{[\s\S]*message: trimmedMessage,[\s\S]*history/)
  assert.match(grounding, /Eu sou a Luna, assistente virtual da Quatro Patas/)
  assert.match(grounding, /alreadyIntroduced = \(history \|\| \[\]\)\.some/)
})

test('confirmação terminal sempre encerra com agradecimento da Luna', () => {
  const localChat = read('server/lib/chat.js')
  assert.match(localChat, /const PETBOT_FRIENDLY_CLOSING = 'Agradecemos pela preferência! Estamos à disposição\. Volte sempre! 😊'/)
  assert.match(localChat, /return `\$\{committedMessage\}\\n\$\{PETBOT_FRIENDLY_CLOSING\}`/)
  assert.equal((localChat.match(/lines\.push\(PETBOT_FRIENDLY_CLOSING\)/g) || []).length, 2)
})

test('opções de produto são persistidas e revalidadas por id no turno seguinte', () => {
  const localChat = read('server/lib/chat.js')
  assert.match(localChat, /last_product_candidates/)
  assert.match(localChat, /previousCandidateState\?\.fact_signature === currentProductFactsSignature/)
  assert.match(localChat, /previousCandidates\.map\(\(candidate\) => candidate\.id\)/)
  assert.match(localChat, /resolveRecentProductCandidate/)
  assert.match(localChat, /selected_product_id: selectedRecentProductCandidate\?\.id/)
  assert.match(localChat, /mergeProductsById\(refreshedCandidates, liveProducts\)/)
  assert.match(localChat, /mergeProductsById\(freshProducts, liveProducts\)/)
  assert.match(localChat, /selected_candidate:[\s\S]*sufficient_stock/)
})

test('busca de ração com marca consulta a marca diretamente antes do ranking', () => {
  const localChat = read('server/lib/chat.js')
  const catalog = read('server/lib/petbotCatalog.js')
  assert.match(localChat, /explicitBrandMatches[\s\S]*searchProductsByTerms\([\s\S]*\[cleanText\(known\.brand\)\]/)
  assert.match(catalog, /rationRequest && requestedBrand && !matchesRequestedBrand/)
})

test('configuracao de deploy expoe debounce seguro e modelos de midia', () => {
  const env = read('.env.example')
  assert.match(env, /WHATSAPP_REPLY_DEBOUNCE_MS=1000/)
  assert.match(env, /OPENAI_TRANSCRIPTION_MODEL=/)
  assert.match(env, /OPENAI_VISION_MODEL=/)
})

test('confirmacao transacional usa resposta terminal sem devolver o turno para a LLM', () => {
  const agent = read('server/lib/petbotAgent.js')
  const chat = read('server/lib/chat.js')
  assert.match(agent, /resolveTerminalReply/)
  assert.match(agent, /terminal:\s*true/)
  assert.match(chat, /if \(currentMessageIsConfirmation\) \{[\s\S]*executeTool\(confirmationToolCall\)/)
  assert.match(chat, /arguments: JSON\.stringify\(\{ confirmation: true \}\)/)
  assert.match(chat, /tokensUsed: 0/)
  assert.match(chat, /toolName !== 'create_confirmed_petshop_order'/)
  assert.match(chat, /\['committed', 'already_committed'\]/)
})

test('servico completo prepara resumo deterministico sem nova etapa comercial', () => {
  const chat = read('server/lib/chat.js')
  const grounding = read('server/lib/petbotGrounding.js')
  assert.match(chat, /shouldForceServicePreparation/)
  assert.match(chat, /name: 'prepare_petshop_service_booking'/)
  assert.match(chat, /result\?\.status\) === 'prepared'/)
  assert.match(grounding, /Durante agendamentos não ofereça produto, corte de unhas nem outro serviço adicional/)
})

test('turno antigo nao sobrescreve sessao atualizada por mensagem mais nova', () => {
  const chat = read('server/lib/chat.js')
  assert.match(chat, /sessionUpdate = sessionUpdate\.eq\('last_message_at', expectedLastMessageAt\)/)
  assert.match(chat, /staleError\.code = 'PETBOT_STALE_TURN'/)
  assert.match(chat, /if \(error\?\.code === 'PETBOT_STALE_TURN'\) throw error/)
})

test('confirmacao transacional atualiza o token antes da protecao contra concorrencia', () => {
  const chat = read('server/lib/chat.js')
  assert.match(chat, /if \(orderResult\) \{[\s\S]*select\('context, last_message_at'\)/)
  assert.match(chat, /concurrencySession = sessionAfterTransaction/)
  assert.match(chat, /expectedLastMessageAt = cleanText\(concurrencySession\.last_message_at\)/)
})

test('mensagem do painel atualiza o token do proprio turno antes de responder', () => {
  const chat = read('server/lib/chat.js')
  assert.match(chat, /insertUserMessages\(supabase, sessionId, userMessages\)[\s\S]*select\('last_message_at'\)/)
  assert.ok(chat.indexOf('insertUserMessages(supabase, sessionId, userMessages)') < chat.indexOf('interpretPetbotMessageWithLlm({'))
  assert.match(chat, /session: sessionForTurn/)
  assert.match(chat, /sessionForAgent,/)
})

test('coordenador serverless trata turno obsoleto como cancelamento esperado', () => {
  const coordinator = read('server/lib/dashboardChat.js')
  const api = read('src/lib/api.js')
  const dashboardApi = read('serverless/dashboardApi.ts')
  assert.match(api, /error\.status = response\.status/)
  assert.match(api, /error\.code = payload\.error\?\.code \|\| payload\.code/)
  assert.match(dashboardApi, /sendJson\(res, status, \{ error: message, code \}\)/)
  assert.match(coordinator, /error\?\.code === 'PETBOT_STALE_TURN'/)
  assert.match(coordinator, /newer customer message superseded/)
  assert.match(coordinator, /releaseDashboardTurn/)
})

test('mensagem do painel sobrevive a troca de rota sem depender de debounce no navegador', () => {
  const hook = read('src/shared/hooks/useChat.js')
  const chatPage = read('src/modules/petshop/pages/ChatPage.jsx')
  const coordinator = read('server/lib/dashboardChat.js')
  const migration = read('supabase/migrations/20260725001000_serverless_dashboard_chat_ingestion.sql')
  const clientSend = hook.slice(hook.indexOf('const sendClientMessage'), hook.indexOf('const sendHumanMessage'))

  assert.doesNotMatch(hook, /pendingDashboardMessages|dashboardReplyTimers|DEFAULT_DASHBOARD_REPLY_DEBOUNCE_MS/)
  assert.doesNotMatch(clientSend, /\.from\('chat_messages'\)/)
  assert.match(clientSend, /requestChatReply\(sessionId, trimmed/)
  assert.match(hook, /crypto\.randomUUID\(\)/)
  assert.match(coordinator, /DEFAULT_QUIET_WINDOW_MS = 900/)
  assert.match(coordinator, /acquire_dashboard_chat_turn/)
  assert.match(migration, /client_message_id already belongs to another message/)
  assert.match(chatPage, /sessionStorage\.setItem\(activeChatStorageKey, session\.id\)/)
  assert.match(chatPage, /sessionStorage\.getItem\(activeChatStorageKey\)/)
})

test('webhook combina mensagens curtas consecutivas antes de chamar o runtime', () => {
  const webhook = read('serverless/whatsappWebhook.ts')
  assert.match(webhook, /loadRecentIncomingBurst/)
  assert.match(webhook, /MAX_WHATSAPP_BURST_WINDOW_MS = 10_000/)
  assert.match(webhook, /burst\.join\('\\n'\)/)
})

test('agenda separa banho/tosa e veterinaria em abas', () => {
  const agenda = read('src/modules/petshop/pages/AgendaPage.jsx')
  const appointments = read('src/shared/hooks/useAppointments.js')

  assert.match(agenda, /AGENDA_TABS/)
  assert.match(agenda, /Banho\/Tosa/)
  assert.match(agenda, /Veterinária/)
  assert.match(agenda, /getAppointmentServiceGroup/)
  assert.match(appointments, /banho\.\*tosa/)
  assert.match(appointments, /vet\|consulta\|clinica\|medico/)
})

test('ordens mantem cards ativos de hoje e historico concluido em tabela', () => {
  const page = read('src/modules/petshop/pages/OrdensEntregaPage.jsx')
  const hook = read('src/modules/petshop/hooks/usePetshopAdvancedCore.js')

  assert.match(page, /activeOrders/)
  assert.match(page, /completedOrders/)
  assert.match(page, /CompletedOrdersTable/)
  assert.match(page, /Historico de concluidas/)
  assert.match(page, /\.filter\(\(step\) => step\.id !== 'concluida'\)/)
  assert.match(hook, /excludeStatus/)
  assert.match(hook, /dateField/)
  assert.match(hook, /\.limit\(limit\)/)
})

test('PetBot usa configuracao de modelo e temperatura no runtime compartilhado', () => {
  const localChat = read('server/lib/chat.js')
  const webhook = read('serverless/whatsappWebhook.ts')

  assert.match(localChat, /DEFAULT_BOT_TEMPERATURE = 0\.5/)
  assert.match(localChat, /runtimeConfig\.temperature/)
  assert.match(webhook, /respondToChatMessage/)
  assert.match(webhook, /temperature: 0/)
})

test('PetBot usa LLM para interpretar e conduzir o agente sem guardiao conversacional', () => {
  const localChat = read('server/lib/chat.js')
  const webhook = read('serverless/whatsappWebhook.ts')
  const ai = read('server/lib/petbotAi.js')
  const agent = read('server/lib/petbotAgent.js')

  assert.match(ai, /interpretPetbotMessageWithLlm/)
  assert.match(localChat, /interpretPetbotMessageWithLlm/)
  assert.match(localChat, /runPetbotAgent/)
  assert.match(localChat, /mergeServiceFactsFromToolArgs/)
  assert.match(agent, /structured interpreter is the preferred semantic source/)
  assert.doesNotMatch(localChat, /runPetbotGuard/)
  assert.doesNotMatch(webhook, /runPetbotGuard/)
})

test('atos semânticos são a fonte primária e reconhecedores literais ficam como fallback', () => {
  const localChat = read('server/lib/chat.js')
  const ai = read('server/lib/petbotAi.js')
  const grounding = read('server/lib/petbotGrounding.js')

  assert.match(ai, /resolvePetbotTurnSemantics/)
  assert.match(ai, /dialogue_act/)
  assert.match(ai, /reply_target/)
  assert.match(ai, /SEMANTIC_CONFIDENCE_THRESHOLD/)
  assert.match(localChat, /const turnSemantics = resolvePetbotTurnSemantics/)
  assert.match(localChat, /turnSemantics\?\.confirms_pending_order/)
  assert.match(localChat, /const explicitCurrentMessageConfirmation = Boolean\([\s\S]*pendingAtTurnStart[\s\S]*isExplicitPetbotConfirmation\(trimmedMessage\)/)
  assert.match(localChat, /const trustedCurrentMessageConfirmation = Boolean\([\s\S]*explicitCurrentMessageConfirmation[\s\S]*turnSemantics\?\.confirms_pending_order/)
  assert.match(localChat, /last_turn_semantics: turnSemantics/)
  assert.match(localChat, /turn_semantics: turnSemantics/)
  assert.match(grounding, /semanticFulfillmentType \|\| messageFulfillmentType/)
  assert.match(grounding, /semanticPaymentMethod[\s\S]*\|\| messagePaymentMethod/)
})

test('WhatsApp e painel usam o mesmo runtime auditavel do PetBot', () => {
  const localChat = read('server/lib/chat.js')
  const webhook = read('serverless/whatsappWebhook.ts')
  const migration = read('supabase/migrations/20260720005000_petbot_autonomy_foundation.sql')

  assert.match(webhook, /respondToChatMessage\(supabase as any, session\.id, runtimeMessage/)
  assert.match(webhook, /skipUserPersistence: true/)
  assert.match(webhook, /engine: 'petbot_agent_v3'/)
  assert.match(localChat, /customInstructions/)
  assert.match(localChat, /recordPetbotEvent/)
  assert.match(localChat, /idempotency_key: `\$\{sessionId\}:\$\{pendingAtTurnStart\.id\}`/)
  assert.match(migration, /create table if not exists public\.petbot_events/)
  assert.match(migration, /payment_status := 'aguardando_comprovante'/)
  assert.match(migration, /grant execute on function public\.create_petbot_order_transaction\(jsonb\) to service_role/)
})

test('canario impede a criacao automatica fora dos contatos autorizados', () => {
  const localChat = read('server/lib/chat.js')
  const settings = read('src/shared/pages/SettingsPage.jsx')
  const migration = read('supabase/migrations/20260720006000_petbot_canary_controls.sql')

  assert.match(localChat, /function canPetbotCreateOrders/)
  assert.match(localChat, /Este contato não está habilitado para criação autônoma de pedidos/)
  assert.match(localChat, /autonomyAllowlist/)
  assert.match(settings, /Autonomia do PetBot/)
  assert.match(settings, /Contatos autorizados no canario/)
  assert.match(migration, /default 'canary'/)
  assert.match(migration, /\('assist', 'canary', 'enabled'\)/)
})

test('fluxo legado do WhatsApp tem MotoDog, Pix e checklist configuraveis', () => {
  const migration = read('database/petshop_legacy_whatsapp_flow.sql')
  const settings = read('src/shared/pages/SettingsPage.jsx')
  const guard = read('server/lib/petbotGuard.js')

  assert.match(migration, /pet_transport_options/)
  assert.match(migration, /pix_key/)
  assert.match(migration, /payment_status/)
  assert.match(settings, /Opcoes MotoDog/)
  assert.match(settings, /Chave Pix/)
  assert.match(settings, /message_templates/)
  assert.match(guard, /buildPetbotConfirmationReply/)
  assert.match(guard, /aguardando_comprovante/)
})

test('PetBot v3 deixa a conversa com a LLM e exige operacoes transacionais validadas', () => {
  const localChat = read('server/lib/chat.js')
  const agent = read('server/lib/petbotAgent.js')
  const grounding = read('server/lib/petbotGrounding.js')
  const migration = read('supabase/migrations/20260721006000_petbot_agent_v3_runtime.sql')

  assert.match(agent, /mergeInterpretedPetbotServiceFacts/)
  assert.match(agent, /resolvePetshopService/)
  assert.match(agent, /sameScheduledInstant/)
  assert.match(agent, /validateReply = null/)
  assert.match(agent, /parallel_tool_calls: false/)
  assert.match(localChat, /buildPetbotAgentV3Prompt/)
  assert.match(localChat, /buildProductCheckoutQualificationReply/)
  assert.match(localChat, /recoverProductQueryFactsFromHistory/)
  assert.match(localChat, /productConversationAtTurnStart/)
  assert.match(localChat, /service_transport_mode: null/)
  assert.match(localChat, /payment_method: cleanText\(productFacts\.payment_method\) \|\| null/)
  assert.match(localChat, /delivery_address: cleanText\(productFacts\.delivery_address\) \|\| null/)
  assert.match(localChat, /shouldForceProductPreparation/)
  assert.match(localChat, /product_id: selectedRecentProductCandidate\.id/)
  assert.match(localChat, /product_facts: orderResult \? \{\} : productFacts/)
  assert.match(localChat, /validatePetbotOperationalReply/)
  assert.match(localChat, /createConfirmedPetshopOrderViaRpc/)
  assert.match(localChat, /A migracao transacional do PetBot nao foi aplicada/)
  assert.doesNotMatch(localChat, /return createConfirmedPetshopOrder\(supabase, session, settings, args\)/)
  assert.match(localChat, /idempotency_key: `\$\{sessionId\}:\$\{pendingAtTurnStart\.id\}`/)
  assert.match(localChat, /currentMessageIsConfirmation[\s\S]*create_confirmed_petshop_order/)
  assert.match(localChat, /engine_version: 'petbot_agent_v3'/)
  assert.doesNotMatch(localChat, /buildNaturalPetbotServiceQuestion/)
  assert.match(grounding, /valor não validado/)
  assert.match(grounding, /disponibilidade de agenda sem consulta/)
  assert.match(grounding, /conclusão de pedido sem transação confirmada/)
  assert.match(migration, /create table if not exists public\.petbot_order_commits/)
  assert.match(migration, /from public\.products/)
  assert.match(migration, /from public\.petshop_services/)
  assert.match(migration, /insert into public\.appointments/)
  assert.match(migration, /grant execute on function public\.create_petbot_order_transaction\(jsonb\) to service_role/)
})


test('webhook nao mantem um segundo agente ou fluxo conversacional legado', () => {
  const webhook = read('serverless/whatsappWebhook.ts')
  assert.match(webhook, /respondToChatMessage/)
  assert.doesNotMatch(webhook, /PETBOT_TOOLS|buildSystemPrompt|runPetbotGuard|preparePetshopOrderDraft/)
})

test('preflight operacional nao mistura venda de produto com servico e exige agenda fresca', () => {
  const localChat = read('server/lib/chat.js')
  assert.match(localChat, /if \(interpretedIntent === 'produto'\) return ''/)
  assert.match(localChat, /const appointmentRefresh = needsAgendaRefresh[\s\S]*await refreshAppointmentContext\(\)/)
  assert.match(localChat, /agendaAvailable: appointmentRefresh\.ok/)
  assert.match(localChat, /check_petshop_availability'[\s\S]*species: serviceFacts\.species[\s\S]*weightKg: serviceFacts\.weight_kg/)
})

test('confirmacao repetida de pedido concluido nao reabre o resumo nem duplica a operacao', () => {
  const localChat = read('server/lib/chat.js')
  assert.match(localChat, /respondToAlreadyCommittedConfirmation/)
  assert.match(localChat, /duplicate_confirmation_ignored/)
  assert.match(localChat, /pending_order: null/)
  assert.match(localChat, /A confirmação repetida não criou outro registro/)
  assert.match(localChat, /hasConfirmedOrderContext\(sessionForAgent\)[\s\S]*!getPendingAgentOrder\(recoveredContext\)/)
})

test('painel expõe diagnóstico E2E protegido do PetBot no tenant ativo', () => {
  const settingsPage = read('src/shared/pages/SettingsPage.jsx')
  const diagnosticPanel = read('src/shared/components/PetbotDiagnosticSuite.jsx')
  const apiClient = read('src/lib/api.js')
  const apiRoute = read('api/admin/petbot-e2e.ts')
  const runner = read('scripts/petbot-diagnostic-suite.mjs')

  assert.match(settingsPage, /setPetSettingsTab\('diagnostico'\)/)
  assert.match(settingsPage, /<PetbotDiagnosticSuite tenantId=\{activeTenantId\} canEdit=\{canEdit\} \/>/)
  assert.match(diagnosticPanel, />Agenda</)
  assert.match(diagnosticPanel, /duplicate_confirmation_safe/)
  assert.match(apiClient, /preparePetbotDiagnosticSuite/)
  assert.match(apiClient, /runPetbotDiagnosticCase/)
  assert.match(apiRoute, /isModuleAdmin\(requester, 'petshop'\)/)
  assert.match(apiRoute, /requester\.active_tenant_id !== tenantId/)
  assert.match(apiRoute, /action === 'plan'/)
  assert.match(apiRoute, /action !== 'run_case'/)
  assert.match(apiRoute, /maxDuration: 300/)
  assert.match(runner, /export async function runPetbotDiagnosticCase/)
})
