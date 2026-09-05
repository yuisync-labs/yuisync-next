import assert from 'node:assert/strict'

const required = ['E2E_BASE_URL', 'TENANT_A_EMAIL', 'TENANT_A_PASSWORD', 'TENANT_A_ID', 'TENANT_B_EMAIL', 'TENANT_B_PASSWORD', 'TENANT_B_ID']
const missing = required.filter(name => !process.env[name]?.trim())
if (missing.length) throw new Error(`TENANT_TEST_CONFIGURATION_REQUIRED: ${missing.join(', ')}`)
const base = new URL(process.env.E2E_BASE_URL)
if (!['localhost', '127.0.0.1'].includes(base.hostname) && !base.hostname.includes('staging')) throw new Error('ISOLATION_TEST_REQUIRES_STAGING')
assert.notEqual(process.env.TENANT_A_ID, process.env.TENANT_B_ID)
let requests = 0
async function call(path, options) {
  if (++requests > 40) throw new Error('ISOLATION_REQUEST_BUDGET_EXCEEDED')
  return fetch(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
}
async function login(email, password) {
  const response = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: base.origin }, body: JSON.stringify({ email, password }) })
  assert.equal(response.status, 200, 'Staging sign-in failed')
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await response.body?.cancel()
  assert.ok(cookie, 'Session cookie missing')
  return cookie
}
async function check(email, password, ownTenant, foreignTenant) {
  const cookie = await login(email, password)
  try {
    for (const table of ['clients', 'pets', 'products', 'appointments', 'sales']) {
      for (const tenant of [ownTenant, foreignTenant]) {
        const response = await call('/api/compat/query', { method: 'POST', headers: { cookie, origin: base.origin, 'content-type': 'application/json', 'x-tenant-id': tenant, 'x-module-id': 'petshop' }, body: JSON.stringify({ table, action: 'select', limit: 3, count: 'none' }) })
        assert.equal(response.status, tenant === ownTenant ? 200 : 403, `${table}: unexpected tenant authorization`)
        if (tenant === ownTenant) {
          const body = await response.json()
          assert.ok(Array.isArray(body.data), `${table}: invalid response`)
          assert.ok(body.data.length <= 3, `${table}: response exceeded requested page size`)
          assert.ok(body.data.every(row => row.tenant_id === ownTenant), `${table}: missing or cross-tenant scope`)
        } else await response.body?.cancel()
      }
    }
    for (const tenant of [ownTenant, foreignTenant]) {
      const response = await call('/api/petshop/services?limit=3', { headers: { cookie, 'x-tenant-id': tenant, 'x-module-id': 'petshop' } })
      assert.equal(response.status, tenant === ownTenant ? 200 : 403, 'Native catalog isolation')
      if (tenant === ownTenant) {
        const body = await response.json()
        assert.ok(Array.isArray(body.services) && body.services.length <= 3, 'Native catalog page size')
      } else await response.body?.cancel()
    }
  } finally {
    const response = await call('/api/auth/sign-out', { method: 'POST', headers: { cookie, origin: base.origin, 'content-type': 'application/json' }, body: '{}' })
    await response.body?.cancel()
  }
}
await check(process.env.TENANT_A_EMAIL, process.env.TENANT_A_PASSWORD, process.env.TENANT_A_ID, process.env.TENANT_B_ID)
await check(process.env.TENANT_B_EMAIL, process.env.TENANT_B_PASSWORD, process.env.TENANT_B_ID, process.env.TENANT_A_ID)
console.log(JSON.stringify({ status: 'passed', runtime: 'cloudflare', requests, rows_per_query: 3 }))
