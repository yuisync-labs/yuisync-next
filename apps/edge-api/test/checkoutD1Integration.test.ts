import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'
import { handleCheckoutApiRequest } from '../src/checkoutApi'

const AUTH_SECRET = 'pdv-checkout-d1-test-secret-123456789012345678901234'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    DB: (env as EdgeEnv & { DB: D1Database }).DB,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://edge.test',
    },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())

  expect(response).not.toBeNull()
  if (!response) throw new Error('SIGN_IN_HANDLER_MISSING')
  const diagnostic = await response.clone().text()
  expect(response.status, diagnostic).toBe(200)
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0]
  expect(cookie).toContain('better-auth')
  return cookie
}

describe('PDV checkout D1 integration', () => {
  it('atomically records sale, payment and stock movement, enforces server policies and safely replays idempotency', async () => {
    const runtime = bindings()
    const database = runtime.DB
    const authDatabase = runtime.AUTH_DB
    const suffix = crypto.randomUUID()
    const tenantId = `checkout-tenant-${suffix}`
    const userId = `checkout-user-${suffix}`
    const principalId = `checkout-principal-${suffix}`
    const clientId = `checkout-client-${suffix}`
    const petId = `checkout-pet-${suffix}`
    const productId = `checkout-product-${suffix}`
    const email = `checkout-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await authDatabase.batch([
      authDatabase.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'PDV Checkout Test', email, nowIso),
      authDatabase.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await database.batch([
      database.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'PDV Checkout Tenant','active',?3,?3)")
        .bind(tenantId, `pdv-checkout-${suffix}`, now),
      database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'PDV Checkout Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      database.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      database.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Cliente Teste','11999999999','active',?3,?3)")
        .bind(tenantId, clientId, now),
      database.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Mel','dog','active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
      database.prepare("INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,cost_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Shampoo Teste',1250,500,'active',?3,?3)")
        .bind(tenantId, productId, now),
      database.prepare("INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop',?2,5000,0,0,1,?3)")
        .bind(tenantId, productId, now),
    ])

    try {
      const cookie = await signIn(email, password)
      const requestBody = {
        tenantId,
        moduleId: 'petshop',
        clientId: petId,
        customerName: 'Cliente Balcao',
        paymentMethod: 'pix',
        discount: 2.5,
        deliveryFee: 999,
        source: 'pdv',
        fulfillmentType: 'entrega',
        idempotencyKey: `checkout-${suffix}`,
        items: [{ productId, quantity: 2, upsell: true }],
      }

      const first = await handleCheckoutApiRequest(new Request('https://edge.test/api/petshop/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(requestBody),
      }), runtime)

      expect(first).not.toBeNull()
      if (!first) return
      const firstBody = await first.json<Record<string, any>>()
      expect(first.status, JSON.stringify(firstBody)).toBe(201)
      expect(firstBody.success).toBe(true)
      expect(firstBody.data.sale).toEqual(expect.objectContaining({
        subtotal: 25,
        discount: 2.5,
        delivery_fee: 8,
        total_price: 30.5,
        status: 'concluido',
        source: 'pdv',
        fulfillment_type: 'entrega',
        payment_method: 'pix',
      }))
      expect(firstBody.data.sale.notes).toContain('Taxa de entrega: R$ 8.00')
      expect(firstBody.data.transaction.replayed).toBe(false)
      expect(firstBody.data.fiscal).toEqual({ status: 'not_requested' })

      const saleId = String(firstBody.data.sale.id)
      const storedSale = await database.prepare('SELECT client_id FROM sales WHERE tenant_id=?1 AND module_id=?2 AND id=?3')
        .bind(tenantId, 'petshop', saleId).first<{ client_id: string }>()
      expect(storedSale?.client_id).toBe(clientId)
      const balanceAfterFirst = await database.prepare('SELECT on_hand_milliunits,reserved_milliunits,version FROM inventory_balances WHERE tenant_id=?1 AND module_id=?2 AND product_id=?3')
        .bind(tenantId, 'petshop', productId).first<Record<string, number>>()
      expect(balanceAfterFirst).toEqual(expect.objectContaining({ on_hand_milliunits: 3000, reserved_milliunits: 0, version: 2 }))

      const items = await database.prepare('SELECT position,item_name,quantity_milliunits,unit_price_cents,subtotal_cents,upsell FROM sale_items WHERE tenant_id=?1 AND module_id=?2 AND sale_id=?3')
        .bind(tenantId, 'petshop', saleId).all<Record<string, unknown>>()
      expect(items.results).toEqual([
        expect.objectContaining({ position: 1, item_name: 'Shampoo Teste', quantity_milliunits: 2000, unit_price_cents: 1250, subtotal_cents: 2500, upsell: 1 }),
      ])

      const historyResponse = await handleCompatApiRequest(new Request('https://edge.test/api/compat/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          'x-tenant-id': tenantId,
          'x-module-id': 'petshop',
        },
        body: JSON.stringify({
          table: 'sales',
          action: 'select',
          count: 'exact',
          columns: 'id, client_id, created_at, clients ( id, name, phone, details ), sale_items ( id, quantity, unit_price, subtotal, upsell, products ( id, name, category ) )',
          filters: [
            { op: 'gte', column: 'created_at', value: new Date(now - 60_000).toISOString() },
            { op: 'lte', column: 'created_at', value: new Date(now + 60_000).toISOString() },
          ],
        }),
      }), runtime)
      expect(historyResponse?.status).toBe(200)
      await expect(historyResponse?.json()).resolves.toEqual({
        data: [expect.objectContaining({
          id: saleId,
          client_id: clientId,
          clients: expect.objectContaining({ id: clientId, name: 'Cliente Teste', phone: '11999999999' }),
          sale_items: [expect.objectContaining({
            id: `${saleId}:1`,
            quantity: 2,
            unit_price: 12.5,
            subtotal: 25,
            upsell: true,
            products: expect.objectContaining({ id: productId, name: 'Shampoo Teste' }),
          })],
        })],
        count: 1,
      })

      const payments = await database.prepare('SELECT method,amount_cents,status FROM payments WHERE tenant_id=?1 AND module_id=?2 AND sale_id=?3')
        .bind(tenantId, 'petshop', saleId).all<Record<string, unknown>>()
      expect(payments.results).toEqual([
        expect.objectContaining({ method: 'pix', amount_cents: 3050, status: 'received' }),
      ])

      const movements = await database.prepare('SELECT movement_type,delta_milliunits,stock_before_milliunits,stock_after_milliunits,unit_cost_cents,reference_type,reference_id,reason FROM inventory_movements WHERE tenant_id=?1 AND module_id=?2 AND product_id=?3')
        .bind(tenantId, 'petshop', productId).all<Record<string, unknown>>()
      expect(movements.results).toEqual([
        expect.objectContaining({
          movement_type: 'sale',
          delta_milliunits: -2000,
          stock_before_milliunits: 5000,
          stock_after_milliunits: 3000,
          unit_cost_cents: 500,
          reference_type: 'sale',
          reference_id: saleId,
          reason: 'pdv_checkout',
        }),
      ])

      const replay = await handleCheckoutApiRequest(new Request('https://edge.test/api/petshop/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(requestBody),
      }), runtime)

      expect(replay).not.toBeNull()
      if (!replay) return
      const replayBody = await replay.json<Record<string, any>>()
      expect(replay.status).toBe(200)
      expect(replayBody.data.sale.id).toBe(saleId)
      expect(replayBody.data.transaction.replayed).toBe(true)

      await database.prepare(`
        INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,version,updated_at_ms)
        VALUES(?1,'petshop',?2,1,?3)
        ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json,version=module_settings_extensions.version+1,updated_at_ms=excluded.updated_at_ms
      `).bind(tenantId, JSON.stringify({ max_pdv_discount_percent: 5, delivery_fee: 19.9 }), Date.now()).run()

      const rejected = await handleCheckoutApiRequest(new Request('https://edge.test/api/petshop/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          ...requestBody,
          idempotencyKey: `discount-limit-${suffix}`,
          discount: 1,
          deliveryFee: 0,
          fulfillmentType: 'balcao',
          items: [{ productId, quantity: 1 }],
        }),
      }), runtime)

      expect(rejected).not.toBeNull()
      if (!rejected) return
      const rejectedBody = await rejected.json<Record<string, any>>()
      expect(rejected.status).toBe(409)
      expect(rejectedBody.success).toBe(false)
      expect(rejectedBody.error.code).toBe('DISCOUNT_LIMIT_EXCEEDED')

      const finalBalance = await database.prepare('SELECT on_hand_milliunits,version FROM inventory_balances WHERE tenant_id=?1 AND module_id=?2 AND product_id=?3')
        .bind(tenantId, 'petshop', productId).first<Record<string, number>>()
      expect(finalBalance).toEqual(expect.objectContaining({ on_hand_milliunits: 3000, version: 2 }))

      const saleCount = await database.prepare('SELECT COUNT(*) AS count FROM sales WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').first<{ count: number }>()
      const movementCount = await database.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').first<{ count: number }>()
      const paymentCount = await database.prepare('SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').first<{ count: number }>()
      expect(saleCount?.count).toBe(1)
      expect(movementCount?.count).toBe(1)
      expect(paymentCount?.count).toBe(1)
    } finally {
      await database.prepare('DELETE FROM payments WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM inventory_movements WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM sale_items WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM sales WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM module_settings_extensions WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM inventory_balances WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM catalog_products WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM pets WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM clients WHERE tenant_id=?1 AND module_id=?2').bind(tenantId, 'petshop').run()
      await database.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await database.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await database.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
      await authDatabase.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDatabase.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDatabase.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
