import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const rawBaseUrl = process.argv[2] || process.env.EDGE_STAGING_URL || ''
let baseUrl
try {
  baseUrl = new URL(rawBaseUrl)
} catch {
  console.error('URL de staging inválida ou ausente.')
  process.exit(1)
}

if (baseUrl.protocol !== 'https:') {
  console.error('Smoke test exige URL HTTPS.')
  process.exit(1)
}

const requestId = `smoke-${crypto.randomUUID()}`
const maxAttempts = 12

function describeFailure(path, response, detail) {
  const contentType = response?.headers.get('content-type') || 'ausente'
  const status = response?.status ?? 'sem-resposta'
  return `${path}: status=${status}, content-type=${contentType}, detalhe=${detail}`
}

async function fetchJson(path, expectedStatus) {
  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(new URL(path, baseUrl), {
        headers: { 'x-request-id': requestId },
        signal: AbortSignal.timeout(15_000),
      })
      const contentType = response.headers.get('content-type') || ''
      const rawBody = await response.text()

      if (response.status !== expectedStatus) {
        throw new Error(describeFailure(
          path,
          response,
          `esperado status ${expectedStatus}`,
        ))
      }
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new Error(describeFailure(path, response, 'resposta não é JSON'))
      }

      let body
      try {
        body = JSON.parse(rawBody)
      } catch {
        throw new Error(describeFailure(path, response, 'JSON inválido'))
      }

      if (response.headers.get('x-request-id') !== requestId) {
        throw new Error(`${path}: correlation id não foi preservado`)
      }
      if (response.headers.get('cache-control') !== 'no-store') {
        throw new Error(`${path}: cache-control inesperado`)
      }

      return body
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxAttempts) {
        break
      }

      const waitMs = Math.min(2_000 * attempt, 10_000)
      console.warn(JSON.stringify({
        event: 'edge.staging.smoke.retry',
        path,
        attempt,
        wait_ms: waitMs,
        reason: lastError.message,
      }))
      await delay(waitMs)
    }
  }

  throw new Error(
    `${path}: smoke falhou após ${maxAttempts} tentativas: ${lastError?.message || 'erro desconhecido'}`,
  )
}

const health = await fetchJson('/health', 200)
if (health.status !== 'ok' || health.environment !== 'staging') {
  throw new Error('/health: payload operacional inválido')
}

const readiness = await fetchJson('/ready', 200)
if (
  readiness.status !== 'ready'
  || readiness.checks?.database !== 'ready'
  || readiness.checks?.schema_version !== '21'
  || readiness.checks?.auth_database !== 'configured'
  || readiness.checks?.coordination !== 'ready'
  || readiness.checks?.better_auth !== 'enabled'
  || readiness.checks?.migration_capabilities !== 'closed'
) {
  throw new Error('/ready: Worker não está pronto para staging v21')
}

// Root-level misses are intentionally handled by Cloudflare's SPA fallback and
// return index.html. Probe an /api/* miss instead, because API paths are always
// routed through the Worker and must retain the sanitized JSON 404 contract.
const missing = await fetchJson('/api/smoke-route-must-not-exist', 404)
if (missing.code !== 'NOT_FOUND') {
  throw new Error('404: resposta não está sanitizada')
}

console.log(JSON.stringify({
  event: 'edge.staging.smoke.passed',
  base_url: baseUrl.origin,
  request_id: requestId,
  checks: ['health', 'ready_v21', 'auth_db', 'coordination', 'api_not_found'],
}))
