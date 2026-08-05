import process from 'node:process'

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

async function fetchJson(path, expectedStatus) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { 'x-request-id': requestId },
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json()

  if (response.status !== expectedStatus) {
    throw new Error(`${path}: status ${response.status}, esperado ${expectedStatus}`)
  }
  if (response.headers.get('x-request-id') !== requestId) {
    throw new Error(`${path}: correlation id não foi preservado`)
  }
  if (response.headers.get('cache-control') !== 'no-store') {
    throw new Error(`${path}: cache-control inesperado`)
  }
  return body
}

const health = await fetchJson('/health', 200)
if (health.status !== 'ok' || health.environment !== 'staging') {
  throw new Error('/health: payload operacional inválido')
}

const readiness = await fetchJson('/ready', 200)
if (readiness.status !== 'ready' || readiness.checks?.configuration !== 'ok') {
  throw new Error('/ready: Worker não está pronto')
}

const missing = await fetchJson('/smoke-route-must-not-exist', 404)
if (missing.code !== 'NOT_FOUND') {
  throw new Error('404: resposta não está sanitizada')
}

console.log(JSON.stringify({
  event: 'edge.staging.smoke.passed',
  base_url: baseUrl.origin,
  request_id: requestId,
  checks: ['health', 'ready', 'not_found'],
}))
