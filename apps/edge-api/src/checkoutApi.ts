import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type CheckoutBindings = BetterAuthRuntimeBindings & { DB?: D1Database }

type CheckoutItem = {
  productId: string
  quantity: number
  quantityMilliunits: number
  upsell: boolean
}

type CheckoutPayment = {
  method: 'pix' | 'cash' | 'card'
  amountCents: number
}

type CheckoutPayload = {
  tenantId: string
  moduleId: 'petshop'
  requestedClientId: string | null
  customerName: string
  customerPhone: string | null
  source: 'manual' | 'pos' | 'whatsapp' | 'import'
  fulfillmentType: 'counter' | 'delivery' | 'service'
  discountCents: number
  transportFeeCents: number
  notes: string | null
  operationKey: string
  items: CheckoutItem[]
  rawPayments: Array<{ method: unknown; amount: unknown }>
  fallbackPaymentMethod: unknown
}

type ProductRow = {
  id: string
  name: string
  price_cents: number
  status: string
  on_hand_milliunits: number | null
  reserved_milliunits: number | null
  inventory_version: number | null
}

type AuthorizedScope = {
  principalId: string
  tenantId: string
  moduleId: string
}

type SaleRow = {
  id: string
  tenant_id: string
  module_id: string
  client_id: string | null
  subtotal_cents: number
  discount_cents: number
  transport_fee_cents: number
  total_cents: number
  status: string
  source: string
  fulfillment_type: string
  notes: string | null
  created_at_ms: number
  customer_name: string | null
  customer_phone: string | null
  payment_method: string | null
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const MAX_ITEMS = 100
const MAX_PAYMENTS = 10
const MAX_QUANTITY = 1_000_000

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function moneyToCents(value: unknown): number {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) return Number.NaN
  return Math.round(number * 100)
}

function quantityToMilliunits(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number > MAX_QUANTITY) return Number.NaN
  const milliunits = Math.round(number * 1000)
  return milliunits > 0 ? milliunits : Number.NaN
}

export function normalizeCheckoutPaymentMethod(value: unknown): 'pix' | 'cash' | 'card' | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes('pix')) return 'pix'
  if (normalized.includes('dinheiro') || normalized === 'cash') return 'cash'
  if (
    normalized.includes('cart')
    || normalized.includes('credito')
    || normalized.includes('crédito')
    || normalized.includes('debito')
    || normalized.includes('débito')
    || normalized === 'card'
  ) return 'card'
  return null
}

export function normalizeCheckoutSource(value: unknown): 'manual' | 'pos' | 'whatsapp' | 'import' {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'pdv' || normalized === 'pos') return 'pos'
  if (normalized === 'whatsapp') return 'whatsapp'
  if (normalized === 'import') return 'import'
  return 'manual'
}

export function normalizeCheckoutFulfillment(value: unknown): 'counter' | 'delivery' | 'service' {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'entrega' || normalized === 'delivery') return 'delivery'
  if (normalized === 'servico' || normalized === 'serviço' || normalized === 'service') return 'service'
  return 'counter'
}

export function normalizeCheckoutPayload(body: unknown): CheckoutPayload {
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const tenantId = text(input.tenantId ?? input.tenant_id, 160)
  const moduleId = text(input.moduleId ?? input.module_id, 64).toLowerCase() || 'petshop'
  if (!ID.test(tenantId)) throw new Error('INVALID_TENANT')
  if (moduleId !== 'petshop') throw new Error('INVALID_MODULE')

  const rawItems = Array.isArray(input.items) ? input.items.slice(0, MAX_ITEMS) : []
  if (!rawItems.length) throw new Error('EMPTY_CART')

  const itemsByProduct = new Map<string, CheckoutItem>()
  for (const rawItem of rawItems) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : {}
    const productId = text(item.productId ?? item.product_id, 160)
    const quantityMilliunits = quantityToMilliunits(item.quantity)
    if (!ID.test(productId) || !Number.isFinite(quantityMilliunits)) throw new Error('INVALID_CART_ITEM')

    const current = itemsByProduct.get(productId)
    if (current) {
      const merged = current.quantityMilliunits + quantityMilliunits
      if (merged > MAX_QUANTITY * 1000) throw new Error('INVALID_CART_ITEM')
      current.quantityMilliunits = merged
      current.quantity = merged / 1000
      current.upsell ||= item.upsell === true
    } else {
      itemsByProduct.set(productId, {
        productId,
        quantity: quantityMilliunits / 1000,
        quantityMilliunits,
        upsell: item.upsell === true,
      })
    }
  }

  const discountCents = moneyToCents(input.discount)
  const transportFeeCents = moneyToCents(input.deliveryFee ?? input.delivery_fee ?? input.transportFee ?? input.transport_fee)
  if (!Number.isFinite(discountCents) || discountCents < 0) throw new Error('INVALID_DISCOUNT')
  if (!Number.isFinite(transportFeeCents) || transportFeeCents < 0) throw new Error('INVALID_TRANSPORT_FEE')

  const idempotencyKey = text(input.idempotencyKey ?? input.idempotency_key, 128)
  if (!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED')

  const rawPayments = (Array.isArray(input.paymentSplits ?? input.payment_splits)
    ? input.paymentSplits ?? input.payment_splits
    : []) as unknown[]

  return {
    tenantId,
    moduleId: 'petshop',
    requestedClientId: text(input.clientId ?? input.client_id, 160) || null,
    customerName: text(input.customerName ?? input.customer_name, 120) || 'Balcao',
    customerPhone: text(input.customerPhone ?? input.customer_phone, 40) || null,
    source: normalizeCheckoutSource(input.source),
    fulfillmentType: normalizeCheckoutFulfillment(input.fulfillmentType ?? input.fulfillment_type),
    discountCents,
    transportFeeCents,
    notes: text(input.notes, 1000) || null,
    operationKey: `pdv:${idempotencyKey}`,
    items: [...itemsByProduct.values()],
    rawPayments: rawPayments.slice(0, MAX_PAYMENTS).map((entry) => {
      const payment = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return { method: payment.method ?? payment.payment_method, amount: payment.amount }
    }),
    fallbackPaymentMethod: input.paymentMethod ?? input.payment_method,
  }
}

export function normalizeCheckoutPayments(
  payload: CheckoutPayload,
  totalCents: number,
): CheckoutPayment[] {
  if (totalCents < 0) throw new Error('INVALID_TOTAL')
  if (totalCents === 0) {
    if (payload.rawPayments.some((payment) => moneyToCents(payment.amount) > 0)) throw new Error('PAYMENT_TOTAL_MISMATCH')
    return []
  }

  if (payload.rawPayments.length) {
    const payments = payload.rawPayments.map((payment) => {
      const method = normalizeCheckoutPaymentMethod(payment.method)
      const amountCents = moneyToCents(payment.amount)
      if (!method || !Number.isFinite(amountCents) || amountCents <= 0) throw new Error('INVALID_PAYMENT')
      return { method, amountCents }
    })
    if (payments.reduce((sum, payment) => sum + payment.amountCents, 0) !== totalCents) {
      throw new Error('PAYMENT_TOTAL_MISMATCH')
    }
    return payments
  }

  const method = normalizeCheckoutPaymentMethod(payload.fallbackPaymentMethod)
  if (!method) throw new Error('PAYMENT_METHOD_REQUIRED')
  return [{ method, amountCents: totalCents }]
}

function moduleAccess(modulePermissionsJson: string | null, moduleId: string): boolean {
  try {
    const permissions = JSON.parse(modulePermissionsJson || '{}') as Record<string, unknown>
    const permission = permissions[moduleId] ?? permissions['*']
    return permission === true || typeof permission === 'string' || Boolean(permission && typeof permission === 'object')
  } catch {
    return false
  }
}

async function authorizeCheckout(request: Request, bindings: CheckoutBindings, payload: CheckoutPayload): Promise<AuthorizedScope | Response> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id, 255)
  if (!userId) return json({ code: 'UNAUTHENTICATED' }, 401)

  const row = await bindings.DB.prepare(`
    SELECT p.id AS principal_id, m.role, m.module_permissions_json, m.status AS membership_status, t.status AS tenant_status
    FROM identity_principals p
    JOIN tenant_memberships m ON m.principal_id = p.id
    JOIN tenants t ON t.id = m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active' AND m.tenant_id=?2
    LIMIT 1
  `).bind(userId, payload.tenantId).first<{
    principal_id: string
    role: string
    module_permissions_json: string | null
    membership_status: string
    tenant_status: string
  }>()

  if (!row || row.membership_status !== 'active' || row.tenant_status !== 'active') {
    return json({ code: 'FORBIDDEN' }, 403)
  }
  if (row.role !== 'owner' && row.role !== 'admin' && !moduleAccess(row.module_permissions_json, payload.moduleId)) {
    return json({ code: 'FORBIDDEN' }, 403)
  }
  return { principalId: row.principal_id, tenantId: payload.tenantId, moduleId: payload.moduleId }
}

async function resolveClientId(database: D1Database, payload: CheckoutPayload): Promise<string | null> {
  if (!payload.requestedClientId) return null
  const row = await database.prepare(`
    SELECT id FROM clients
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active'
    UNION ALL
    SELECT client_id AS id FROM pets
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active'
    LIMIT 1
  `).bind(payload.tenantId, payload.moduleId, payload.requestedClientId).first<{ id: string }>()
  if (!row?.id) throw new Error('CLIENT_NOT_FOUND')
  return row.id
}

async function loadProducts(database: D1Database, payload: CheckoutPayload): Promise<Map<string, ProductRow>> {
  const placeholders = payload.items.map(() => '?').join(',')
  const statement = database.prepare(`
    SELECT p.id,p.name,p.price_cents,p.status,
           i.on_hand_milliunits,i.reserved_milliunits,i.version AS inventory_version
    FROM catalog_products p
    LEFT JOIN inventory_balances i
      ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
    WHERE p.tenant_id=? AND p.module_id=? AND p.id IN (${placeholders})
  `).bind(payload.tenantId, payload.moduleId, ...payload.items.map((item) => item.productId))
  const result = await statement.all<ProductRow>()
  return new Map(result.results.map((row) => [row.id, row]))
}

function validateProducts(payload: CheckoutPayload, products: Map<string, ProductRow>): Array<CheckoutItem & ProductRow> {
  return payload.items.map((item) => {
    const product = products.get(item.productId)
    if (!product || product.status !== 'active') throw new Error('PRODUCT_UNAVAILABLE')
    const onHand = Number(product.on_hand_milliunits ?? 0)
    const reserved = Number(product.reserved_milliunits ?? 0)
    if (!Number.isInteger(product.price_cents) || product.price_cents < 0) throw new Error('PRODUCT_PRICE_INVALID')
    if (!Number.isInteger(product.inventory_version) || onHand - reserved < item.quantityMilliunits) {
      throw new Error('INSUFFICIENT_STOCK')
    }
    return { ...item, ...product }
  })
}

function legacySaleStatus(value: string): string {
  return ({ pending: 'pendente', confirmed: 'confirmado', completed: 'concluido', cancelled: 'cancelado', refunded: 'reembolsado' } as Record<string, string>)[value] || value
}

function legacySource(value: string): string {
  return value === 'pos' ? 'pdv' : value
}

function legacyFulfillment(value: string): string {
  return ({ counter: 'balcao', delivery: 'entrega', service: 'servico' } as Record<string, string>)[value] || value
}

function legacyPaymentMethod(value: string | null): string | null {
  if (value === 'cash') return 'dinheiro'
  if (value === 'card') return 'cartao'
  return value
}

async function loadSale(database: D1Database, payload: CheckoutPayload): Promise<SaleRow | null> {
  return database.prepare(`
    SELECT s.id,s.tenant_id,s.module_id,s.client_id,s.subtotal_cents,s.discount_cents,s.transport_fee_cents,s.total_cents,
           s.status,s.source,s.fulfillment_type,s.notes,s.created_at_ms,
           c.name AS customer_name,c.phone AS customer_phone,
           (SELECT p.method FROM payments p
             WHERE p.tenant_id=s.tenant_id AND p.module_id=s.module_id AND p.sale_id=s.id
             ORDER BY p.created_at_ms,p.id LIMIT 1) AS payment_method
    FROM sales s
    LEFT JOIN clients c ON c.tenant_id=s.tenant_id AND c.module_id=s.module_id AND c.id=s.client_id
    WHERE s.tenant_id=?1 AND s.module_id=?2 AND s.operation_key=?3
    LIMIT 1
  `).bind(payload.tenantId, payload.moduleId, payload.operationKey).first<SaleRow>()
}

function saleResponse(row: SaleRow, payload: CheckoutPayload, replayed: boolean) {
  return {
    sale: {
      id: row.id,
      tenant_id: row.tenant_id,
      module_id: row.module_id,
      client_id: row.client_id,
      customer_name: row.customer_name || payload.customerName,
      customer_phone: row.customer_phone || payload.customerPhone,
      payment_method: legacyPaymentMethod(row.payment_method),
      subtotal: row.subtotal_cents / 100,
      discount: row.discount_cents / 100,
      delivery_fee: row.transport_fee_cents / 100,
      total_price: row.total_cents / 100,
      status: legacySaleStatus(row.status),
      source: legacySource(row.source),
      fulfillment_type: legacyFulfillment(row.fulfillment_type),
      notes: row.notes,
      created_at: new Date(row.created_at_ms).toISOString(),
    },
    transaction: {
      sale_id: row.id,
      operation_key: payload.operationKey,
      replayed,
    },
    fiscal: { status: 'not_requested' },
  }
}

function errorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'CHECKOUT_FAILED'
  const mappings: Record<string, [number, string]> = {
    INVALID_TENANT: [400, 'Empresa invalida.'],
    INVALID_MODULE: [400, 'Modulo invalido.'],
    EMPTY_CART: [400, 'Carrinho vazio.'],
    INVALID_CART_ITEM: [400, 'Carrinho contem itens invalidos.'],
    INVALID_DISCOUNT: [400, 'Desconto invalido.'],
    INVALID_TRANSPORT_FEE: [400, 'Taxa de entrega invalida.'],
    IDEMPOTENCY_REQUIRED: [400, 'Chave de idempotencia obrigatoria.'],
    CLIENT_NOT_FOUND: [400, 'Cliente selecionado nao encontrado.'],
    PRODUCT_UNAVAILABLE: [409, 'Um produto do carrinho nao esta disponivel.'],
    PRODUCT_PRICE_INVALID: [409, 'Um produto do carrinho possui preco invalido.'],
    INSUFFICIENT_STOCK: [409, 'Estoque insuficiente para concluir a venda.'],
    INVALID_PAYMENT: [400, 'Pagamento invalido.'],
    PAYMENT_TOTAL_MISMATCH: [409, 'A soma dos pagamentos deve ser igual ao total da venda.'],
    PAYMENT_METHOD_REQUIRED: [400, 'Forma de pagamento obrigatoria.'],
    INVALID_TOTAL: [400, 'Total da venda invalido.'],
    DISCOUNT_EXCEEDS_SUBTOTAL: [409, 'O desconto nao pode superar o subtotal.'],
    CHECKOUT_CONFLICT: [409, 'Estoque ou preco mudou durante a venda. Atualize o carrinho e tente novamente.'],
  }
  const [status, message] = mappings[code] || [500, 'Falha ao concluir venda.']
  return json({ success: false, data: null, error: { code, message } }, status)
}

async function executeCheckout(request: Request, bindings: CheckoutBindings): Promise<Response> {
  if (!bindings.DB) return json({ success: false, data: null, error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Banco nao configurado.' } }, 503)

  let payload: CheckoutPayload
  try {
    payload = normalizeCheckoutPayload(await request.json())
  } catch (error) {
    return errorResponse(error)
  }

  const authorization = await authorizeCheckout(request, bindings, payload)
  if (authorization instanceof Response) return authorization

  const existing = await loadSale(bindings.DB, payload)
  if (existing) return json({ success: true, data: saleResponse(existing, payload, true), error: null }, 200)

  try {
    const clientId = await resolveClientId(bindings.DB, payload)
    const productRows = validateProducts(payload, await loadProducts(bindings.DB, payload))
    const subtotalCents = productRows.reduce((sum, item) => (
      sum + Math.round(item.price_cents * item.quantityMilliunits / 1000)
    ), 0)
    if (payload.discountCents > subtotalCents) throw new Error('DISCOUNT_EXCEEDS_SUBTOTAL')
    const totalCents = subtotalCents - payload.discountCents + payload.transportFeeCents
    const payments = normalizeCheckoutPayments(payload, totalCents)
    const saleId = crypto.randomUUID()
    const now = Date.now()

    const guardClauses: string[] = []
    const guardValues: Array<string | number> = []
    for (const item of productRows) {
      guardClauses.push(`EXISTS (
        SELECT 1 FROM catalog_products p
        JOIN inventory_balances i ON i.tenant_id=p.tenant_id AND i.module_id=p.module_id AND i.product_id=p.id
        WHERE p.tenant_id=? AND p.module_id=? AND p.id=? AND p.status='active'
          AND p.price_cents=? AND i.version=? AND (i.on_hand_milliunits-i.reserved_milliunits)>=?
      )`)
      guardValues.push(payload.tenantId, payload.moduleId, item.productId, item.price_cents, item.inventory_version!, item.quantityMilliunits)
    }

    const statements: D1PreparedStatement[] = [
      bindings.DB.prepare(`
        INSERT INTO sales(
          tenant_id,module_id,id,operation_key,client_id,appointment_id,source,fulfillment_type,
          subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms
        )
        SELECT ?,?,?,?,?,NULL,?,?,?,?,?,?, 'completed',?,?,?
        WHERE ${guardClauses.join(' AND ')}
      `).bind(
        payload.tenantId,
        payload.moduleId,
        saleId,
        payload.operationKey,
        clientId,
        payload.source,
        payload.fulfillmentType,
        subtotalCents,
        payload.discountCents,
        payload.transportFeeCents,
        totalCents,
        payload.notes,
        now,
        now,
        ...guardValues,
      ),
    ]

    productRows.forEach((item, index) => {
      const subtotal = Math.round(item.price_cents * item.quantityMilliunits / 1000)
      statements.push(
        bindings.DB!.prepare(`
          INSERT INTO sale_items(
            tenant_id,module_id,sale_id,position,item_type,product_id,service_id,item_name,
            quantity_milliunits,unit_price_cents,subtotal_cents,upsell
          ) VALUES(?,?,?,?, 'product',?,NULL,?,?,?,?,?)
        `).bind(
          payload.tenantId,payload.moduleId,saleId,index,item.productId,item.name,
          item.quantityMilliunits,item.price_cents,subtotal,item.upsell ? 1 : 0,
        ),
        bindings.DB!.prepare(`
          UPDATE inventory_balances
          SET on_hand_milliunits=on_hand_milliunits-?,version=version+1,updated_at_ms=?
          WHERE tenant_id=? AND module_id=? AND product_id=? AND version=?
            AND (on_hand_milliunits-reserved_milliunits)>=?
        `).bind(
          item.quantityMilliunits,now,payload.tenantId,payload.moduleId,item.productId,item.inventory_version!,item.quantityMilliunits,
        ),
        bindings.DB!.prepare(`
          INSERT INTO inventory_movements(
            tenant_id,module_id,id,operation_key,product_id,movement_type,delta_milliunits,
            stock_before_milliunits,stock_after_milliunits,unit_cost_cents,reference_type,reference_id,reason,created_at_ms
          ) VALUES(?,?,?,?,?,'sale',?,?,?,?,?,'sale',?,'pdv_checkout',?)
        `).bind(
          payload.tenantId,payload.moduleId,crypto.randomUUID(),`sale:${saleId}:stock:${index}`,
          item.productId,-item.quantityMilliunits,item.on_hand_milliunits!,item.on_hand_milliunits!-item.quantityMilliunits,
          null,saleId,now,
        ),
      )
    })

    payments.forEach((payment, index) => {
      statements.push(bindings.DB!.prepare(`
        INSERT INTO payments(
          tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,provider,provider_reference,
          received_at_ms,created_at_ms,updated_at_ms
        ) VALUES(?,?,?,?,?,?,?,'received',NULL,NULL,?,?,?)
      `).bind(
        payload.tenantId,payload.moduleId,crypto.randomUUID(),saleId,`sale:${saleId}:payment:${index}`,
        payment.method,payment.amountCents,now,now,now,
      ))
    })

    try {
      await bindings.DB.batch(statements)
    } catch (batchError) {
      const replay = await loadSale(bindings.DB, payload)
      if (replay) return json({ success: true, data: saleResponse(replay, payload, true), error: null }, 200)
      console.error(JSON.stringify({ event: 'pdv_checkout.batch_failed', tenant_id: payload.tenantId, error: String(batchError) }))
      throw new Error('CHECKOUT_CONFLICT')
    }

    const created = await loadSale(bindings.DB, payload)
    if (!created) throw new Error('CHECKOUT_CONFLICT')
    return json({ success: true, data: saleResponse(created, payload, false), error: null }, 201)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function handleCheckoutApiRequest(request: Request, bindings: CheckoutBindings): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname !== '/api/petshop/checkout') return null
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
  return executeCheckout(request, bindings)
}
