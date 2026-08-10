#!/usr/bin/env node

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
const DOMAIN = 'yuisync.app'
const SERVICE = 'yuisync-edge-api-production'
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()

function requireCredentials() {
  if (!ACCOUNT_ID) throw new Error('CLOUDFLARE_ACCOUNT_ID_REQUIRED')
  if (!API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN_REQUIRED')
}

async function api(path, options = {}) {
  requireCredentials()
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message || entry?.code).filter(Boolean).join(';')
      : `HTTP_${response.status}`
    throw new Error(`CLOUDFLARE_API_FAILED:${path}:${detail || response.status}`)
  }
  return payload
}

async function domainRows() {
  const payload = await api(`/workers/domains?hostname=${encodeURIComponent(DOMAIN)}`)
  return Array.isArray(payload.result) ? payload.result : []
}

export function classifyDomainRows(rows) {
  const exact = (Array.isArray(rows) ? rows : []).filter((row) => String(row?.hostname || '') === DOMAIN)
  const ours = exact.filter((row) => String(row?.service || '') === SERVICE)
  const foreign = exact.filter((row) => String(row?.service || '') !== SERVICE)
  return { exact, ours, foreign }
}

async function inspect() {
  const { exact, ours, foreign } = classifyDomainRows(await domainRows())
  console.log(JSON.stringify({
    status: 'inspected',
    hostname: DOMAIN,
    service: SERVICE,
    exact_count: exact.length,
    production_count: ours.length,
    foreign_services: foreign.map((row) => String(row?.service || 'unknown')),
  }))
  return { exact, ours, foreign }
}

async function detach() {
  const { ours, foreign } = await inspect()
  if (foreign.length) {
    throw new Error(`PRODUCTION_DOMAIN_OWNED_BY_OTHER_SERVICE:${foreign.map((row) => row?.service || 'unknown').join(',')}`)
  }
  if (!ours.length) {
    console.log(JSON.stringify({ status: 'already-detached', hostname: DOMAIN }))
    return
  }
  if (ours.length !== 1 || !ours[0]?.id) throw new Error(`PRODUCTION_DOMAIN_NOT_UNIQUE:${ours.length}`)
  await api(`/workers/domains/${encodeURIComponent(String(ours[0].id))}`, { method: 'DELETE' })
  console.log(JSON.stringify({ status: 'detached', hostname: DOMAIN, service: SERVICE }))
}

async function verifyAttached() {
  const { ours, foreign } = await inspect()
  if (foreign.length) throw new Error('PRODUCTION_DOMAIN_FOREIGN_SERVICE_PRESENT')
  if (ours.length !== 1) throw new Error(`PRODUCTION_DOMAIN_ATTACHMENT_COUNT:${ours.length}`)
  console.log(JSON.stringify({ status: 'attached', hostname: DOMAIN, service: SERVICE }))
}

async function workersUrl() {
  const payload = await api('/workers/subdomain')
  const subdomain = String(payload?.result?.subdomain || '').trim()
  if (!subdomain) throw new Error('WORKERS_SUBDOMAIN_MISSING')
  const url = `https://${SERVICE}.${subdomain}.workers.dev`
  if (process.env.GITHUB_ENV) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_ENV, `YUISYNC_PRODUCTION_WORKERS_URL=${url}\n`, 'utf8')
  }
  console.log(JSON.stringify({ status: 'resolved', url }))
}

async function main() {
  if (COMMAND === 'inspect') return inspect()
  if (COMMAND === 'detach') return detach()
  if (COMMAND === 'verify-attached') return verifyAttached()
  if (COMMAND === 'workers-url') return workersUrl()
  throw new Error('Usage: node scripts/migration/production-domain.mjs <inspect|detach|verify-attached|workers-url>')
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
