import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type InventoryAdjustmentDependencies = { getSession?: SessionResolver }

type Scope = { tenantId: string; moduleId: string }
type MovementType = 'adjustment' | 'purchase'

type AdjustmentInput = Scope & {
  productId: string
  deltaUnits: number
  operationKey: string
  movementType: MovementType
  reason?: string | null
  referenceType?: string | null
  referenceId?: string | null
  unitCostCents?: number | null
}

export class InventoryAdjustmentError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message)
    this.name = 'InventoryAdjustmentError'
  }
}

function validId(value: unknown, max = 200): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function validModule(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function permissions(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function hasModuleAccess(role: string, raw: string | null, moduleId: string): boolean {
  if (role === 'owner' || role === 'admin') return true
  const parsed = permissions(raw)
  return parsed['*'] === true || Boolean(parsed[moduleId])
}

async function resolveScope(
  request: Request,
  bindings: Bindings,
  getSession: SessionResolver,
): Promise<Scope> {
  if (!bindings.DB) throw new InventoryAdjustmentError('DATABASE_NOT_CONFIGURED', 503, 'Banco não configurado.')
  const tenantId = validId(request.headers.get('x-tenant-id'), 160)
  const moduleId = validModule(request.headers.get('x-module-id'))
  if (!tenantId || !moduleId) throw new InventoryAdjustmentError('INVALID_SCOPE', 400, 'Tenant/módulo inválido.')

  const session = await getSession(request, bindings)
  const userId = validId(session?.user?.id, 255)
  if (!userId) throw new InventoryAdjustmentError('UNAUTHENTICATED', 401, 'Sessão necessária.')

  const row = await bindings.DB.prepare(`
    SELECT membership.role,membership.module_permissions_json,tenant.status AS tenant_status
    FROM identity_principals principal
    JOIN tenant_memberships membership ON membership.principal_id=principal.id
    JOIN tenants tenant ON tenant.id=membership.tenant_id
    WHERE principal.provider='better-auth' AND principal.subject=?1 AND principal.status='active'
      AND membership.tenant_id=?2 AND membership.status='active'
    LIMIT 1
  `).bind(userId, tenantId).first<{ role: string; module_permissions_json: string | null; tenant_status: string }>()
  if (!row || row.tenant_status !== 'active' || !hasModuleAccess(row.role, row.module_permissions_json, moduleId)) {
    throw new InventoryAdjustmentError('FORBIDDEN', 403, 'Sem acesso ao estoque deste tenant.')
  }
  return { tenantId, moduleId }
}

export async function adjustInventoryStock(database: D1Database, input: AdjustmentInput) {
  const productId = validId(input.productId, 160)
  const operationKey = validId(input.operationKey, 200)
  const deltaMilliunits = Math.round(Number(input.deltaUnits) * 1000)
  if (!productId || !operationKey || !Number.isFinite(deltaMilliunits) || deltaMilliunits === 0) {
    throw new InventoryAdjustmentError('INVALID_STOCK_ADJUSTMENT', 400, 'Ajuste de estoque inválido.')
  }
  if (!['adjustment', 'purchase'].includes(input.movementType)) {
    throw new InventoryAdjustmentError('INVALID_MOVEMENT_TYPE', 400, 'Tipo de movimento inválido.')
  }

  const product = await database.prepare(`
    SELECT id FROM catalog_products
    WHERE tenant_id=?1 AND module_id=?2 AND id=?3 AND status='active'
    LIMIT 1
  `).bind(input.tenantId, input.moduleId, productId).first<{ id: string }>()
  if (!product) throw new InventoryAdjustmentError('PRODUCT_NOT_FOUND', 404, 'Produto não encontrado.')

  const existing = await database.prepare(`
    SELECT product_id,delta_milliunits,stock_before_milliunits,stock_after_milliunits
    FROM inventory_movements
    WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3
    LIMIT 1
  `).bind(input.tenantId, input.moduleId, operationKey).first<{
    product_id: string; delta_milliunits: number; stock_before_milliunits: number; stock_after_milliunits: number
  }>()
  if (existing) {
    if (existing.product_id !== productId || Number(existing.delta_milliunits) !== deltaMilliunits) {
      throw new InventoryAdjustmentError('IDEMPOTENCY_KEY_REUSED', 409, 'Chave de operação já usada em outro ajuste.')
    }
    return {
      product_id: productId,
      stock_before: Number(existing.stock_before_milliunits) / 1000,
      stock_after: Number(existing.stock_after_milliunits) / 1000,
      delta: deltaMilliunits / 1000,
      duplicated: true,
    }
  }

  const now = Date.now()
  const movementId = crypto.randomUUID()
  const unitCostCents = input.unitCostCents == null ? null : Math.max(0, Math.round(Number(input.unitCostCents)))

  await database.batch([
    database.prepare(`
      INSERT INTO inventory_balances(
        tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms
      ) VALUES(?1,?2,?3,0,0,0,1,?4)
      ON CONFLICT(tenant_id,module_id,product_id) DO NOTHING
    `).bind(input.tenantId, input.moduleId, productId, now),
    database.prepare(`
      INSERT INTO inventory_movements(
        tenant_id,module_id,id,operation_key,product_id,movement_type,delta_milliunits,
        stock_before_milliunits,stock_after_milliunits,unit_cost_cents,reference_type,reference_id,reason,created_at_ms
      )
      SELECT ?1,?2,?3,?4,?5,?6,?7,
             balance.on_hand_milliunits,balance.on_hand_milliunits+?7,?8,?9,?10,?11,?12
      FROM inventory_balances balance
      WHERE balance.tenant_id=?1 AND balance.module_id=?2 AND balance.product_id=?5
        AND balance.on_hand_milliunits+?7 >= balance.reserved_milliunits
        AND NOT EXISTS (
          SELECT 1 FROM inventory_movements movement
          WHERE movement.tenant_id=?1 AND movement.module_id=?2 AND movement.operation_key=?4
        )
    `).bind(
      input.tenantId, input.moduleId, movementId, operationKey, productId, input.movementType, deltaMilliunits,
      unitCostCents, validId(input.referenceType, 120), validId(input.referenceId, 200),
      input.reason ? String(input.reason).slice(0, 500) : null, now,
    ),
    database.prepare(`
      UPDATE inventory_balances
      SET on_hand_milliunits=on_hand_milliunits+?4,version=version+1,updated_at_ms=?5
      WHERE tenant_id=?1 AND module_id=?2 AND product_id=?3
        AND EXISTS (
          SELECT 1 FROM inventory_movements movement
          WHERE movement.tenant_id=?1 AND movement.module_id=?2 AND movement.operation_key=?6
            AND movement.product_id=?3
            AND movement.stock_before_milliunits=inventory_balances.on_hand_milliunits
            AND movement.stock_after_milliunits=inventory_balances.on_hand_milliunits+?4
        )
    `).bind(input.tenantId, input.moduleId, productId, deltaMilliunits, now, operationKey),
  ])

  const movement = await database.prepare(`
    SELECT product_id,delta_milliunits,stock_before_milliunits,stock_after_milliunits
    FROM inventory_movements
    WHERE tenant_id=?1 AND module_id=?2 AND operation_key=?3
    LIMIT 1
  `).bind(input.tenantId, input.moduleId, operationKey).first<{
    product_id: string; delta_milliunits: number; stock_before_milliunits: number; stock_after_milliunits: number
  }>()
  if (!movement) {
    throw new InventoryAdjustmentError('INSUFFICIENT_AVAILABLE_STOCK', 409, 'O ajuste deixaria o estoque abaixo da quantidade reservada.')
  }

  return {
    product_id: productId,
    stock_before: Number(movement.stock_before_milliunits) / 1000,
    stock_after: Number(movement.stock_after_milliunits) / 1000,
    delta: deltaMilliunits / 1000,
    duplicated: false,
  }
}

export async function handleInventoryAdjustmentRequest(
  request: Request,
  bindings: Bindings,
  dependencies: InventoryAdjustmentDependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (pathname !== '/api/app/inventory/adjust') return null
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const scope = await resolveScope(request, bindings, dependencies.getSession || getBetterAuthSession)
    let body: Record<string, unknown>
    try { body = await request.json() as Record<string, unknown> } catch {
      throw new InventoryAdjustmentError('INVALID_JSON', 400, 'JSON inválido.')
    }
    const result = await adjustInventoryStock(bindings.DB!, {
      ...scope,
      productId: String(body.product_id || ''),
      deltaUnits: Number(body.delta),
      operationKey: String(body.operation_key || ''),
      movementType: body.movement_type === 'purchase' ? 'purchase' : 'adjustment',
      reason: body.reason == null ? null : String(body.reason),
      referenceType: body.reference_type == null ? null : String(body.reference_type),
      referenceId: body.reference_id == null ? null : String(body.reference_id),
      unitCostCents: body.unit_cost_cents == null ? null : Number(body.unit_cost_cents),
    })
    return json({ adjustment: result })
  } catch (error) {
    if (error instanceof InventoryAdjustmentError) return json({ code: error.code, message: error.message }, error.status)
    console.error('inventory.adjust.failed', { error_name: error instanceof Error ? error.name : 'Error' })
    return json({ code: 'INVENTORY_ADJUSTMENT_FAILED' }, 500)
  }
}
