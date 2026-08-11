#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const FIXTURE_PATH = resolve(REPO_ROOT, '.artifacts/staging-e2e/fixture.json')
const BASE_URL = String(process.env.E2E_BASE_URL || process.env.YUISYNC_E2E_BASE_URL || process.env.YUISYNC_STAGING_URL || '').replace(/\/$/, '')

if (!BASE_URL.startsWith('https://')) throw new Error('STAGING_REALTIME_BASE_URL_REQUIRED')

function assert(condition, code, details = {}) {
  if (!condition) throw new Error(`${code}:${JSON.stringify(details)}`)
}

const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
const tenantId = String(fixture?.tenantId || '')
const email = String(process.env.E2E_EMAIL || '')
const password = String(process.env.E2E_PASSWORD || '')

assert(tenantId.startsWith('e2e-') && tenantId.endsWith('-tenant'), 'UNSAFE_FIXTURE_TENANT', { tenantId })
assert(email.endsWith('@staging.invalid') && password.length >= 12, 'STAGING_E2E_CREDENTIALS_REQUIRED')

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const signIn = await context.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    headers: { origin: BASE_URL },
    data: { email, password, rememberMe: false },
  })
  assert(signIn.status() === 200, 'STAGING_REALTIME_SIGN_IN_FAILED', { status: signIn.status(), body: await signIn.text().catch(() => '') })

  const page = await context.newPage()
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })

  const subscribed = await page.evaluate(async ({ baseUrl, tenant }) => {
    return new Promise((resolvePromise, rejectPromise) => {
      const url = new URL('/api/realtime', baseUrl)
      url.protocol = 'wss:'
      url.searchParams.set('tenant_id', tenant)
      url.searchParams.set('module_id', 'petshop')
      const socket = new WebSocket(url)
      globalThis.__yuisyncRealtimeE2E = socket
      const timeout = setTimeout(() => rejectPromise(new Error('REALTIME_SUBSCRIBE_TIMEOUT')), 15000)
      socket.onerror = () => {
        clearTimeout(timeout)
        rejectPromise(new Error('REALTIME_SOCKET_ERROR'))
      }
      socket.onmessage = (event) => {
        let payload
        try { payload = JSON.parse(String(event.data || '')) } catch { return }
        if (payload?.type !== 'realtime.system' || payload?.event !== 'SUBSCRIBED') return
        clearTimeout(timeout)
        resolvePromise(payload)
      }
    })
  }, { baseUrl: BASE_URL, tenant: tenantId })

  assert(subscribed?.tenantId === tenantId && subscribed?.moduleId === 'petshop', 'STAGING_REALTIME_SUBSCRIBE_SCOPE_MISMATCH', subscribed)

  const invalidationPromise = page.evaluate(async () => {
    return new Promise((resolvePromise, rejectPromise) => {
      const socket = globalThis.__yuisyncRealtimeE2E
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN) {
        rejectPromise(new Error('REALTIME_SOCKET_NOT_OPEN'))
        return
      }
      const timeout = setTimeout(() => rejectPromise(new Error('REALTIME_INVALIDATION_TIMEOUT')), 15000)
      const handler = (event) => {
        let payload
        try { payload = JSON.parse(String(event.data || '')) } catch { return }
        if (payload?.type !== 'realtime.invalidate') return
        clearTimeout(timeout)
        socket.removeEventListener('message', handler)
        resolvePromise(payload)
      }
      socket.addEventListener('message', handler)
    })
  })

  const mutation = await context.request.post(`${BASE_URL}/api/compat/query`, {
    headers: {
      origin: BASE_URL,
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    },
    data: {
      table: 'settings',
      action: 'update',
      payload: { realtime_e2e_nonce: `nonce-${Date.now()}` },
      filters: [],
      orders: [],
      mode: 'many',
      returning: false,
    },
  })
  assert(mutation.ok(), 'STAGING_REALTIME_MUTATION_FAILED', { status: mutation.status(), body: await mutation.text().catch(() => '') })

  const invalidation = await invalidationPromise
  assert(invalidation?.type === 'realtime.invalidate', 'STAGING_REALTIME_EVENT_TYPE_MISMATCH', invalidation)
  assert(invalidation?.eventType === 'SYNC', 'STAGING_REALTIME_COMPAT_EVENT_MISMATCH', invalidation)
  assert(invalidation?.tenantId === tenantId && invalidation?.moduleId === 'petshop', 'STAGING_REALTIME_EVENT_SCOPE_MISMATCH', invalidation)
  assert(invalidation?.table === 'settings', 'STAGING_REALTIME_EVENT_TABLE_MISMATCH', invalidation)
  assert(invalidation?.source === '/api/compat/query', 'STAGING_REALTIME_EVENT_SOURCE_MISMATCH', invalidation)

  await page.evaluate(() => {
    const socket = globalThis.__yuisyncRealtimeE2E
    if (socket instanceof WebSocket) socket.close(1000, 'e2e_complete')
    delete globalThis.__yuisyncRealtimeE2E
  })

  console.log(JSON.stringify({
    status: 'passed',
    tenant_id: tenantId,
    module_id: 'petshop',
    authenticated_websocket: true,
    mutation_invalidation: true,
    event_id: invalidation.eventId || null,
  }))
} finally {
  await browser.close()
}
