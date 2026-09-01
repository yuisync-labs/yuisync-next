import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function listFilesRecursive(path) {
  const root = new URL(`../${path}`, import.meta.url)
  const output = []
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const fullPath = join(directory, name)
      if (statSync(fullPath).isDirectory()) visit(fullPath)
      else output.push(fullPath)
    }
  }
  visit(fileURLToPath(root))
  return output
}

test('hotfix reutiliza a funcao chat/respond e preserva o limite de 12 funcoes Vercel', () => {
  const apiFiles = listFilesRecursive('api').filter((path) => /\.(ts|js)$/.test(path))
  const vercel = read('vercel.json')
  const respondRoute = read('api/chat/respond.ts')
  const localServer = read('server/index.js')

  assert.equal(apiFiles.length, 12)
  assert.match(vercel, /"api\/chat\/respond\.ts"/)
  assert.match(respondRoute, /handleChatRespondRoute/)
  assert.match(vercel, /"api\/chat\/respond\.ts"[\s\S]*"maxDuration": 120/)
  assert.match(localServer, /ingestAndRespondToDashboardChat/)
  assert.doesNotMatch(vercel, /chat\/messages|chat\/ingest|chat\/worker/)
})

test('mensagem simulada nao e mais persistida diretamente pelo navegador', () => {
  const hook = read('src/shared/hooks/useChat.js')
  const api = read('src/lib/api.js')
  const sendStart = hook.indexOf('const sendClientMessage')
  const sendEnd = hook.indexOf('const sendHumanMessage', sendStart)
  const clientSend = hook.slice(sendStart, sendEnd)

  assert.ok(sendStart > -1 && sendEnd > sendStart)
  assert.doesNotMatch(clientSend, /\.from\(['"]chat_messages['"]\)/)
  assert.doesNotMatch(clientSend, /sent_at\s*:/)
  assert.doesNotMatch(hook, /pendingDashboardMessages|dashboardReplyTimers|setTimeout\(\(\) => \{\s*void flushClientMessages/)
  assert.match(clientSend, /requestChatReply\(sessionId, trimmed/)
  assert.match(api, /clientMessageId: options\.clientMessageId/)
})

test('backend define ingestao idempotente, versao e lease no banco', () => {
  const migration = read('supabase/migrations/20260725001000_serverless_dashboard_chat_ingestion.sql')
  const coordinator = read('server/lib/dashboardChat.js')
  const dashboardApi = read('serverless/dashboardApi.ts')

  assert.match(migration, /create or replace function public\.ingest_dashboard_chat_message/)
  assert.match(migration, /dashboard_message_version bigint not null default 0/)
  assert.match(migration, /dashboard_processed_version bigint not null default 0/)
  assert.match(migration, /dashboard_processing_token uuid/)
  assert.match(migration, /dashboard_turn_version bigint/)
  assert.match(migration, /sent_at = v_now/)
  assert.match(migration, /grant execute on function public\.ingest_dashboard_chat_message[\s\S]*to service_role/)
  assert.match(coordinator, /acquire_dashboard_chat_turn/)
  assert.match(coordinator, /skipUserPersistence: true/)
  assert.match(coordinator, /server_serialized: true/)
  assert.match(dashboardApi, /ingestAndRespondToDashboardChat/)
})

test('mensagens realtime sao reordenadas e substituem o item otimista', () => {
  const hook = read('src/shared/hooks/useChat.js')

  assert.match(hook, /function sortChatMessages/)
  assert.match(hook, /return sortChatMessages\(next\)/)
  assert.match(hook, /event: '\*'/)
  assert.match(hook, /payload\.eventType === 'DELETE'/)
  assert.match(hook, /dashboard_turn_version/)
})

test('fallback nao promete preparar resumo sem executar e faz handoff real', () => {
  const chat = read('server/lib/chat.js')

  assert.doesNotMatch(chat, /Vou preparar o resumo com os dados confirmados/)
  assert.match(chat, /PETBOT_PREPARATION_RECOVERY_HANDOFF_REPLY/)
  assert.match(chat, /needsHuman = true[\s\S]*handoffTarget = 'atendente'/)
})
