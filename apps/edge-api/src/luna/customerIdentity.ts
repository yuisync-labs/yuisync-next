import type { LunaExecutionContext } from './contracts'

export async function isConversationCustomer(database: D1Database, context: LunaExecutionContext, customerId: string): Promise<boolean> {
  const phone = context.customerAddress.replace(/^\+/, '')
  if (!/^\d{8,15}$/.test(phone) || !customerId) return false
  const rows = await database.prepare(`
    SELECT id FROM clients WHERE tenant_id=?1 AND module_id=?2 AND status='active'
      AND (phone=?3 OR phone=?4) ORDER BY id LIMIT 2
  `).bind(context.tenantId, context.moduleId, phone, `+${phone}`).all<{ id: string }>()
  return rows.results.length === 1 && rows.results[0].id === customerId
}
