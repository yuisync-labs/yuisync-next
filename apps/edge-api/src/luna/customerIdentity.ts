import type { LunaExecutionContext } from './contracts'

// The store keeps most phones as DDD + number (no 55), some with the old 8-digit
// mobile; WhatsApp sends 55 + DDD, with or without the 9. Every spelling of the
// same Brazilian number is tried, so a registered customer is found either way.
export function phoneVariants(address: string): string[] {
  const digits = address.replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(digits)) return []
  const local = /^55\d{10,11}$/.test(digits) ? digits.slice(2) : digits
  const forms = new Set([digits, local])
  if (/^\d{2}9\d{8}$/.test(local)) forms.add(local.slice(0, 2) + local.slice(3))
  if (/^\d{2}[6-9]\d{7}$/.test(local)) forms.add(local.slice(0, 2) + '9' + local.slice(2))
  for (const form of [...forms]) if (/^\d{10,11}$/.test(form)) forms.add('55' + form)
  return [...forms].flatMap(form => [form, '+' + form])
}

export async function isConversationCustomer(database: D1Database, context: LunaExecutionContext, customerId: string): Promise<boolean> {
  const phones = phoneVariants(context.customerAddress)
  if (!phones.length || !customerId) return false
  const rows = await database.prepare(`
    SELECT id FROM clients WHERE tenant_id=?1 AND module_id=?2 AND status='active'
      AND phone IN (SELECT value FROM json_each(?3)) ORDER BY id LIMIT 2
  `).bind(context.tenantId, context.moduleId, JSON.stringify(phones)).all<{ id: string }>()
  return rows.results.length === 1 && rows.results[0].id === customerId
}
