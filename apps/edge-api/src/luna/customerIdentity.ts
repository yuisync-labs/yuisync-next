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

// Imported data often has the same person registered twice under one phone.
// Same name means one customer; different names stay ambiguous.
export function samePerson(names: unknown[]): boolean {
  const keys = new Set(names.map(name => String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()))
  return keys.size === 1 && !keys.has('')
}

// Clients of this conversation's phone (?3, from phoneVariants): on the record,
// or linked after the customer confirmed a CPF already on file.
export const conversationClients = `status='active' AND (phone IN (SELECT value FROM json_each(?3)) OR id IN (SELECT client_id FROM luna_customer_links WHERE tenant_id=?1 AND module_id=?2 AND phone IN (SELECT value FROM json_each(?3))))`

export async function isConversationCustomer(database: D1Database, context: LunaExecutionContext, customerId: string): Promise<boolean> {
  const phones = phoneVariants(context.customerAddress)
  if (!phones.length || !customerId) return false
  const rows = await database.prepare(`
    SELECT id,name FROM clients WHERE tenant_id=?1 AND module_id=?2 AND ${conversationClients} ORDER BY id LIMIT 10
  `).bind(context.tenantId, context.moduleId, JSON.stringify(phones)).all<{ id: string; name: string }>()
  return rows.results.some(row => row.id === customerId) && (rows.results.length === 1 || samePerson(rows.results.map(row => row.name)))
}
