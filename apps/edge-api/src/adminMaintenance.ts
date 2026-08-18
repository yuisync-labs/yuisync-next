import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

type Bindings = BetterAuthRuntimeBindings & { DB?: D1Database }
type SessionResolver = typeof getBetterAuthSession
export type AdminMaintenanceDependencies = { getSession?: SessionResolver }

type Scope = { tenantId: string; moduleId: string }

export class AdminMaintenanceError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message)
    this.name = 'AdminMaintenanceError'
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function validId(value: unknown, max = 160): string | null {
  const normalized = String(value ?? '').trim()
  return normalized && normalized.length <= max ? normalized : null
}

function validModule(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null
}

async function resolveAdminScope(
  request: Request,
  bindings: Bindings,
  body: Record<string, unknown>,
  getSession: SessionResolver,
): Promise<Scope> {
  if (!bindings.DB) throw new AdminMaintenanceError('DATABASE_NOT_CONFIGURED', 503, 'Banco não configurado.')
  const tenantId = validId(body.tenantId ?? body.tenant_id)
  const moduleId = validModule(body.moduleId ?? body.module_id)
  if (!tenantId || !moduleId) throw new AdminMaintenanceError('INVALID_SCOPE', 400, 'Tenant/módulo inválido.')

  const session = await getSession(request, bindings)
  const userId = validId(session?.user?.id, 255)
  if (!userId) throw new AdminMaintenanceError('UNAUTHENTICATED', 401, 'Sessão necessária.')

  const membership = await bindings.DB.prepare(`
    SELECT membership.role,tenant.status AS tenant_status
    FROM identity_principals principal
    JOIN tenant_memberships membership ON membership.principal_id=principal.id
    JOIN tenants tenant ON tenant.id=membership.tenant_id
    WHERE principal.provider='better-auth' AND principal.subject=?1 AND principal.status='active'
      AND membership.tenant_id=?2 AND membership.status='active'
    LIMIT 1
  `).bind(userId, tenantId).first<{ role: string; tenant_status: string }>()

  if (!membership || membership.tenant_status !== 'active' || !['owner', 'admin'].includes(membership.role)) {
    throw new AdminMaintenanceError('FORBIDDEN', 403, 'A manutenção exige administrador do tenant.')
  }
  return { tenantId, moduleId }
}

export async function resetChatHistoryForScope(database: D1Database, scope: Scope) {
  const [threads, messages, checkpoints] = await Promise.all([
    database.prepare('SELECT COUNT(*) AS count FROM chat_threads WHERE tenant_id=?1 AND module_id=?2')
      .bind(scope.tenantId, scope.moduleId).first<{ count: number }>(),
    database.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE tenant_id=?1 AND module_id=?2')
      .bind(scope.tenantId, scope.moduleId).first<{ count: number }>(),
    database.prepare(`
      SELECT COUNT(*) AS count FROM operation_checkpoints
      WHERE tenant_id=?1 AND module_id=?2 AND thread_id IS NOT NULL
    `).bind(scope.tenantId, scope.moduleId).first<{ count: number }>(),
  ])

  await database.batch([
    database.prepare(`
      DELETE FROM operation_checkpoints
      WHERE tenant_id=?1 AND module_id=?2 AND thread_id IS NOT NULL
    `).bind(scope.tenantId, scope.moduleId),
    database.prepare('DELETE FROM chat_threads WHERE tenant_id=?1 AND module_id=?2')
      .bind(scope.tenantId, scope.moduleId),
  ])

  return {
    threads_deleted: Number(threads?.count || 0),
    messages_deleted: Number(messages?.count || 0),
    checkpoints_deleted: Number(checkpoints?.count || 0),
  }
}

export async function resetStockForScope(database: D1Database, scope: Scope) {
  const reserved = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM inventory_balances
    WHERE tenant_id=?1 AND module_id=?2 AND reserved_milliunits>0
  `).bind(scope.tenantId, scope.moduleId).first<{ count: number }>()
  if (Number(reserved?.count || 0) > 0) {
    throw new AdminMaintenanceError(
      'STOCK_RESET_BLOCKED_BY_RESERVATIONS',
      409,
      'Existem produtos com estoque reservado. Libere as reservas antes de zerar o estoque.',
    )
  }

  const balances = await database.prepare(`
    SELECT product_id
    FROM inventory_balances
    WHERE tenant_id=?1 AND module_id=?2 AND on_hand_milliunits<>0
    ORDER BY product_id
  `).bind(scope.tenantId, scope.moduleId).all<{ product_id: string }>()
  if (!balances.results.length) return { products_reset: 0 }

  const batchId = crypto.randomUUID()
  const now = Date.now()
  const statements: D1PreparedStatement[] = []

  balances.results.forEach((balance, index) => {
    const operationKey = `reset-stock:${batchId}:${index}`
    const movementId = crypto.randomUUID()
    statements.push(
      database.prepare(`
        INSERT INTO inventory_movements(
          tenant_id,module_id,id,operation_key,product_id,movement_type,delta_milliunits,
          stock_before_milliunits,stock_after_milliunits,reason,created_at_ms
        )
        SELECT ?1,?2,?3,?4,product_id,'adjustment',-on_hand_milliunits,
               on_hand_milliunits,0,'Zeragem administrativa de estoque',?6
        FROM inventory_balances
        WHERE tenant_id=?1 AND module_id=?2 AND product_id=?5
          AND reserved_milliunits=0 AND on_hand_milliunits<>0
      `).bind(scope.tenantId, scope.moduleId, movementId, operationKey, balance.product_id, now),
      database.prepare(`
        UPDATE inventory_balances
        SET on_hand_milliunits=0,version=version+1,updated_at_ms=?6
        WHERE tenant_id=?1 AND module_id=?2 AND product_id=?5
          AND reserved_milliunits=0 AND on_hand_milliunits<>0
          AND EXISTS (
            SELECT 1 FROM inventory_movements movement
            WHERE movement.tenant_id=?1 AND movement.module_id=?2
              AND movement.operation_key=?4 AND movement.product_id=?5
              AND movement.stock_before_milliunits=inventory_balances.on_hand_milliunits
              AND movement.stock_after_milliunits=0
          )
      `).bind(scope.tenantId, scope.moduleId, movementId, operationKey, balance.product_id, now),
    )
  })

  await database.batch(statements)

  const remaining = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM inventory_balances
    WHERE tenant_id=?1 AND module_id=?2 AND on_hand_milliunits<>0
  `).bind(scope.tenantId, scope.moduleId).first<{ count: number }>()
  if (Number(remaining?.count || 0) > 0) {
    throw new AdminMaintenanceError('STOCK_RESET_CONFLICT', 409, 'O estoque mudou durante a zeragem. Recarregue e tente novamente.')
  }

  return { products_reset: balances.results.length }
}

export async function handleAdminMaintenanceRequest(
  request: Request,
  bindings: Bindings,
  dependencies: AdminMaintenanceDependencies = {},
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  const action = pathname === '/api/admin/maintenance/reset-chat'
    ? 'reset-chat'
    : pathname === '/api/admin/maintenance/reset-stock'
      ? 'reset-stock'
      : null
  if (!action) return null
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    let body: Record<string, unknown>
    try { body = await request.json() as Record<string, unknown> } catch {
      throw new AdminMaintenanceError('INVALID_JSON', 400, 'JSON inválido.')
    }
    const scope = await resolveAdminScope(request, bindings, body, dependencies.getSession || getBetterAuthSession)

    if (action === 'reset-chat') {
      if (body.confirm !== 'RESET_CHAT_HISTORY') {
        throw new AdminMaintenanceError('CONFIRMATION_REQUIRED', 400, 'Confirmação de reset de chat inválida.')
      }
      const result = await resetChatHistoryForScope(bindings.DB!, scope)
      return json({ ok: true, action, ...result })
    }

    if (body.confirm !== 'RESET_STOCK') {
      throw new AdminMaintenanceError('CONFIRMATION_REQUIRED', 400, 'Confirmação de reset de estoque inválida.')
    }
    const result = await resetStockForScope(bindings.DB!, scope)
    return json({ ok: true, action, ...result })
  } catch (error) {
    if (error instanceof AdminMaintenanceError) return json({ code: error.code, message: error.message }, error.status)
    console.error('admin.maintenance.failed', { action, error_name: error instanceof Error ? error.name : 'Error' })
    return json({ code: 'ADMIN_MAINTENANCE_FAILED' }, 500)
  }
}
