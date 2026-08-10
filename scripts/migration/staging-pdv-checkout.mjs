#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const FIXTURE_PATH = resolve(REPO_ROOT, '.artifacts/staging-e2e/fixture.json')
const BASE_URL = String(process.env.E2E_BASE_URL || process.env.YUISYNC_E2E_BASE_URL || process.env.YUISYNC_STAGING_URL || '').replace(/\/$/, '')
const WRANGLER_ENV = String(process.env.YUISYNC_E2E_WRANGLER_ENV || 'staging').trim()

if (!BASE_URL.startsWith('https://')) throw new Error('STAGING_PDV_BASE_URL_REQUIRED')
if (!/^[A-Za-z0-9_-]+$/.test(WRANGLER_ENV)) throw new Error(`INVALID_WRANGLER_ENV:${WRANGLER_ENV}`)

function sql(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

function wrangler(args) {
  return run('npx', ['wrangler', ...args], { cwd: EDGE_DIR })
}

function d1Run(statement) {
  wrangler(['d1', 'execute', 'DB', '--env', WRANGLER_ENV, '--remote', '--command', statement])
}

function d1Rows(statement) {
  const output = wrangler(['d1', 'execute', 'DB', '--env', WRANGLER_ENV, '--remote', '--json', '--command', statement])
  const parsed = JSON.parse(output)
  const result = Array.isArray(parsed) ? parsed[0] : parsed
  return Array.isArray(result?.results) ? result.results : []
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return values.map((value) => String(value).split(';')[0]).filter(Boolean).join('; ')
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}))
  return { response, body }
}

function assert(condition, code, details = {}) {
  if (!condition) throw new Error(`${code}:${JSON.stringify(details)}`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitForCheckoutRoute() {
  const attempts = 45
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${BASE_URL}/api/petshop/checkout?deployment_probe=${Date.now()}-${attempt}`, {
      method: 'GET',
      headers: { 'cache-control': 'no-cache' },
      cache: 'no-store',
    })
    last = {
      attempt,
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      body: await response.text().catch(() => ''),
    }
    if (response.status === 405) return last
    if (response.status !== 404) throw new Error(`STAGING_PDV_ROUTE_UNEXPECTED:${JSON.stringify(last)}`)
    if (attempt < attempts) await sleep(1000)
  }
  throw new Error(`STAGING_PDV_ROUTE_NOT_DEPLOYED:${JSON.stringify(last)}`)
}

const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
const tenantId = String(fixture?.tenantId || '')
const runId = String(fixture?.runId || '')
const email = String(process.env.E2E_EMAIL || '')
const password = String(process.env.E2E_PASSWORD || '')

assert(tenantId.startsWith('e2e-') && tenantId.endsWith('-tenant'), 'UNSAFE_FIXTURE_TENANT', { tenantId })
assert(runId.startsWith('e2e-'), 'INVALID_FIXTURE_RUN', { runId })
assert(email.endsWith('@staging.invalid') && password.length >= 12, 'STAGING_E2E_CREDENTIALS_REQUIRED')

const routeProbe = await waitForCheckoutRoute()
console.log(JSON.stringify({ event: 'staging.pdv.route.ready', attempt: routeProbe.attempt, status: routeProbe.status }))

const productId = `${runId}-pdv-product`
const operationKey = `${runId}-pdv-sale`
const discountOperationKey = `${runId}-pdv-discount-reject`
const now = Date.now()

// The fixture tenant is disposable. Seed checkout policy and one canonical product.
d1Run(`
  INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,version,updated_at_ms)
  VALUES(${sql(tenantId)},'petshop',${sql(JSON.stringify({ max_pdv_discount_percent: 10, delivery_fee: 12.34 }))},1,${now})
  ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json,version=module_settings_extensions.version+1,updated_at_ms=excluded.updated_at_ms;
  INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,cost_cents,status,created_at_ms,updated_at_ms)
  VALUES(${sql(tenantId)},'petshop',${sql(productId)},'PDV Staging Smoke',1250,500,'active',${now},${now});
  INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms)
  VALUES(${sql(tenantId)},'petshop',${sql(productId)},5000,0,0,1,${now});
`)

const signIn = await jsonResponse(await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: BASE_URL,
  },
  body: JSON.stringify({ email, password, rememberMe: false }),
}))
assert(signIn.response.status === 200, 'STAGING_PDV_SIGN_IN_FAILED', { status: signIn.response.status, body: signIn.body })
const cookie = cookieHeader(signIn.response)
assert(cookie.includes('better-auth'), 'STAGING_PDV_SESSION_COOKIE_MISSING')

const checkoutPayload = {
  tenantId,
  moduleId: 'petshop',
  customerName: 'Cliente Staging',
  paymentMethod: 'pix',
  discount: 2.5,
  deliveryFee: 999,
  source: 'pdv',
  fulfillmentType: 'entrega',
  idempotencyKey: operationKey,
  items: [{ productId, quantity: 2, upsell: true }],
}

const first = await jsonResponse(await fetch(`${BASE_URL}/api/petshop/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
  body: JSON.stringify(checkoutPayload),
}))
assert(first.response.status === 201 && first.body?.success === true, 'STAGING_PDV_CHECKOUT_FAILED', { status: first.response.status, url: first.response.url, redirected: first.response.redirected, body: first.body })
assert(first.body?.data?.sale?.subtotal === 25, 'STAGING_PDV_SUBTOTAL_MISMATCH', first.body)
assert(first.body?.data?.sale?.discount === 2.5, 'STAGING_PDV_DISCOUNT_MISMATCH', first.body)
assert(first.body?.data?.sale?.delivery_fee === 12.34, 'STAGING_PDV_SERVER_DELIVERY_FEE_MISMATCH', first.body)
assert(first.body?.data?.sale?.total_price === 34.84, 'STAGING_PDV_TOTAL_MISMATCH', first.body)
assert(first.body?.data?.transaction?.replayed === false, 'STAGING_PDV_FIRST_CALL_MARKED_REPLAY', first.body)
assert(first.body?.data?.fiscal?.status === 'not_requested', 'STAGING_PDV_FISCAL_COUPLING_DETECTED', first.body)

const saleId = String(first.body?.data?.sale?.id || '')
assert(Boolean(saleId), 'STAGING_PDV_SALE_ID_MISSING')

const balance = d1Rows(`SELECT on_hand_milliunits,reserved_milliunits,version FROM inventory_balances WHERE tenant_id=${sql(tenantId)} AND module_id='petshop' AND product_id=${sql(productId)};`)[0]
assert(Number(balance?.on_hand_milliunits) === 3000 && Number(balance?.reserved_milliunits) === 0 && Number(balance?.version) === 2, 'STAGING_PDV_STOCK_MISMATCH', balance)

const payment = d1Rows(`SELECT method,amount_cents,status FROM payments WHERE tenant_id=${sql(tenantId)} AND module_id='petshop' AND sale_id=${sql(saleId)};`)[0]
assert(payment?.method === 'pix' && Number(payment?.amount_cents) === 3484 && payment?.status === 'received', 'STAGING_PDV_PAYMENT_MISMATCH', payment)

const movement = d1Rows(`SELECT movement_type,delta_milliunits,stock_before_milliunits,stock_after_milliunits,unit_cost_cents,reference_type,reference_id,reason FROM inventory_movements WHERE tenant_id=${sql(tenantId)} AND module_id='petshop' AND product_id=${sql(productId)};`)[0]
assert(
  movement?.movement_type === 'sale'
  && Number(movement?.delta_milliunits) === -2000
  && Number(movement?.stock_before_milliunits) === 5000
  && Number(movement?.stock_after_milliunits) === 3000
  && Number(movement?.unit_cost_cents) === 500
  && movement?.reference_type === 'sale'
  && movement?.reference_id === saleId
  && movement?.reason === 'pdv_checkout',
  'STAGING_PDV_MOVEMENT_MISMATCH',
  movement,
)

const replay = await jsonResponse(await fetch(`${BASE_URL}/api/petshop/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
  body: JSON.stringify(checkoutPayload),
}))
assert(replay.response.status === 200 && replay.body?.success === true, 'STAGING_PDV_REPLAY_FAILED', { status: replay.response.status, body: replay.body })
assert(replay.body?.data?.sale?.id === saleId && replay.body?.data?.transaction?.replayed === true, 'STAGING_PDV_REPLAY_MISMATCH', replay.body)

const rejected = await jsonResponse(await fetch(`${BASE_URL}/api/petshop/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
  body: JSON.stringify({
    ...checkoutPayload,
    idempotencyKey: discountOperationKey,
    fulfillmentType: 'balcao',
    discount: 1.26,
    items: [{ productId, quantity: 1 }],
  }),
}))
assert(rejected.response.status === 409 && rejected.body?.error?.code === 'DISCOUNT_LIMIT_EXCEEDED', 'STAGING_PDV_DISCOUNT_POLICY_NOT_ENFORCED', { status: rejected.response.status, body: rejected.body })

const counts = d1Rows(`
  SELECT
    (SELECT COUNT(*) FROM sales WHERE tenant_id=${sql(tenantId)} AND module_id='petshop') AS sales_count,
    (SELECT COUNT(*) FROM payments WHERE tenant_id=${sql(tenantId)} AND module_id='petshop') AS payments_count,
    (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id=${sql(tenantId)} AND module_id='petshop') AS movements_count,
    (SELECT on_hand_milliunits FROM inventory_balances WHERE tenant_id=${sql(tenantId)} AND module_id='petshop' AND product_id=${sql(productId)}) AS stock;
`)[0]
assert(Number(counts?.sales_count) === 1 && Number(counts?.payments_count) === 1 && Number(counts?.movements_count) === 1 && Number(counts?.stock) === 3000, 'STAGING_PDV_SIDE_EFFECT_DUPLICATION', counts)

console.log(JSON.stringify({
  status: 'passed',
  tenant_id: tenantId,
  sale_id: saleId,
  checkout_total: first.body.data.sale.total_price,
  server_delivery_fee: first.body.data.sale.delivery_fee,
  idempotency_replay: true,
  discount_policy_rejection: true,
  stock_after_milliunits: Number(counts.stock),
}))
