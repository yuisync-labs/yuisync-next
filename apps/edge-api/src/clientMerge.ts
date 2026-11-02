// Duplicate tutors: the plan that joins them, and the SQL that applies it.
// Records with one CPF, or one phone (with or without the 9) and a compatible
// name, are one tutor. The tutor with the most history stays; the others'
// pets, history and missing fields move to it, and their rows are removed.
// Every row touched is first copied into client_merge_log (migration 0051).
import { compatibleNames, cpfKey, samePerson } from './clientIdentity'

export type MergeClient = {
  id: string; name: string; document: string | null; phone: string | null; email: string | null; birth_date: string | null
  address: string | null; address_number: string | null; address_complement: string | null; address_reference: string | null
  neighborhood: string | null; city: string | null; postal_code: string | null; notes: string | null
  status: string; created_at_ms: number; updated_at_ms: number
}
export type MergePet = { id: string; client_id: string; name: string }
export type MergePlan = {
  merged: { id: string; into: string }[]
  kept: { id: string; set: Record<string, string> }[]
  placeholderPets: string[]
  normalized: { id: string; document: string }[]
  // Same CPF under another person's name: left alone for the store to check.
  conflicts: { cpf: string; kept: string; other: string[] }[]
}

const FILL = ['phone', 'email', 'birth_date', 'address', 'address_number', 'address_complement', 'address_reference', 'neighborhood', 'city', 'postal_code'] as const
// A CPF, or a company's 14-digit CNPJ.
const documentKey = (document: unknown) => cpfKey(document) ?? (/^\d{14}$/.test(String(document ?? '').replace(/\D/g, '')) ? 'cnpj:' + String(document).replace(/\D/g, '') : null)
const blank = (value: unknown) => String(value ?? '').trim() === ''
const words = (name: unknown) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// DDD + the last 8 digits: "5511991234567", "11991234567" and "551191234567" are one phone.
export function phoneKey(phone: unknown): string | null {
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (/^55\d{10,11}$/.test(digits)) digits = digits.slice(2)
  if (!/^\d{10,11}$/.test(digits)) return null
  return digits.slice(0, 2) + digits.slice(-8)
}

export function planTutorMerge(clients: MergeClient[], pets: MergePet[], history: Record<string, number>): MergePlan {
  const parent = new Map(clients.map(c => [c.id, c.id]))
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; parent.set(id, root); return root }
  const members = new Map(clients.map(c => [c.id, [c]]))
  const union = (a: string, b: string) => {
    const x = find(a), y = find(b)
    if (x === y) return
    parent.set(y, x); members.set(x, [...members.get(x)!, ...members.get(y)!]); members.delete(y)
  }
  const cpfs = (root: string) => new Set(members.get(root)!.map(c => documentKey(c.document)).filter(Boolean))
  const score = (c: MergeClient) => [c.status === 'active' ? 1 : 0, history[c.id] ?? 0, cpfKey(c.document) ? 1 : 0, blank(c.phone) ? 0 : 1, -c.created_at_ms]
  const better = (a: MergeClient, b: MergeClient) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return a.id < b.id }
  const best = (list: MergeClient[]) => list.reduce((a, b) => better(a, b) ? a : b)

  // 1. One CPF: the records whose name matches the one with the most history.
  const conflicts: MergePlan['conflicts'] = []
  const byCpf = new Map<string, MergeClient[]>()
  for (const c of clients) { const cpf = documentKey(c.document); if (cpf) byCpf.set(cpf, [...byCpf.get(cpf) ?? [], c]) }
  for (const [cpf, list] of byCpf) {
    if (list.length < 2) continue
    const head = best(list)
    const same = list.filter(c => compatibleNames(c.name, head.name)), other = list.filter(c => !same.includes(c))
    for (const c of same) union(head.id, c.id)
    if (other.length) conflicts.push({ cpf, kept: head.id, other: other.map(c => c.id) })
  }
  // 2. One phone, compatible names, never two different CPFs.
  const conflicted = new Set(conflicts.flatMap(c => c.other))
  const byPhone = new Map<string, MergeClient[]>()
  for (const c of clients) { const key = phoneKey(c.phone); if (key && !conflicted.has(c.id)) byPhone.set(key, [...byPhone.get(key) ?? [], c]) }
  for (const list of byPhone.values()) for (let i = 1; i < list.length; i++) for (let j = 0; j < i; j++) {
    const a = find(list[i].id), b = find(list[j].id)
    if (a === b) continue
    const names = [...members.get(a)!, ...members.get(b)!].map(c => c.name)
    if (new Set([...cpfs(a), ...cpfs(b)]).size <= 1 && samePerson(names)) union(a, b)
  }

  const plan: MergePlan = { merged: [], kept: [], placeholderPets: [], normalized: [], conflicts }
  const petsOf = new Map<string, MergePet[]>()
  for (const p of pets) petsOf.set(p.client_id, [...petsOf.get(p.client_id) ?? [], p])
  const inMerge = new Set<string>()
  for (const group of members.values()) {
    if (group.length < 2) continue
    const head = best(group), rest = group.filter(c => c !== head)
    const order = [...rest].sort((a, b) => (b.status === 'active' ? 1 : 0) - (a.status === 'active' ? 1 : 0) || b.updated_at_ms - a.updated_at_ms)
    for (const c of rest) plan.merged.push({ id: c.id, into: head.id })
    group.forEach(c => inMerge.add(c.id))
    const set: Record<string, string> = {}
    // The fullest spelling of the name: "Joao Pedro Lima Santos" over "JOAO".
    const name = group.map(c => c.name.trim()).reduce((a, b) => words(b).split(' ').length > words(a).split(' ').length ? b : a, head.name.trim())
    if (name !== head.name) set.name = name
    const cpf = group.map(c => cpfKey(c.document)).find(Boolean)
    if (cpf && head.document !== cpf) set.document = cpf
    for (const field of FILL) if (blank(head[field])) { const from = order.find(c => !blank(c[field])); if (from) set[field] = String(from[field]).trim() }
    if (head.status !== 'active' && group.some(c => c.status === 'active')) set.status = 'active'
    const notes: string[] = []
    for (const note of [head, ...order].map(c => String(c.notes ?? '').trim()).filter(Boolean)) {
      const key = words(note)
      if (!notes.some(kept => words(kept).includes(key))) notes.push(note)
    }
    const joined = notes.join('\n').slice(0, 4000)
    if (joined !== String(head.notes ?? '').trim() && joined) set.notes = joined
    if (Object.keys(set).length) plan.kept.push({ id: head.id, set })
    // A "pet" named after its tutor is an import placeholder, not an animal.
    const tutorNames = new Set(group.map(c => words(c.name)))
    for (const c of group) for (const p of petsOf.get(c.id) ?? []) if (tutorNames.has(words(p.name))) plan.placeholderPets.push(p.id)
  }
  // 3. CPFs that lost their leading zeros, elsewhere.
  for (const c of clients) {
    const cpf = cpfKey(c.document)
    if (cpf && !inMerge.has(c.id) && c.document !== cpf) plan.normalized.push({ id: c.id, document: cpf })
  }
  return plan
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`
const SNAPSHOT_CLIENT = `json_object('id',c.id,'name',c.name,'document',c.document,'phone',c.phone,'email',c.email,'birth_date',c.birth_date,'address',c.address,'address_number',c.address_number,'address_complement',c.address_complement,'address_reference',c.address_reference,'neighborhood',c.neighborhood,'city',c.city,'postal_code',c.postal_code,'notes',c.notes,'status',c.status,'created_at_ms',c.created_at_ms,'updated_at_ms',c.updated_at_ms)`
const SNAPSHOT_PET = `json_object('id',p.id,'client_id',p.client_id,'name',p.name,'species',p.species,'breed',p.breed,'birth_date',p.birth_date,'weight_kg',p.weight_kg,'color',p.color,'notes',p.notes,'status',p.status,'created_at_ms',p.created_at_ms,'updated_at_ms',p.updated_at_ms)`
// Tables that point at a tutor, and the column that does.
const CLIENT_REFERENCES: [string, string][] = [
  ['appointments', 'client_id'], ['sales', 'client_id'], ['chat_threads', 'client_id'], ['client_subscriptions', 'client_id'],
  ['loyalty_points', 'client_id'], ['invoices', 'client_id'], ['petshop_growth_leads', 'client_id'],
  ['petshop_growth_booking_requests', 'client_id'], ['petshop_growth_no_show_events', 'client_id'], ['petshop_campaign_logs', 'client_id'],
  ['service_delivery_orders', 'client_id'], ['luna_customer_links', 'client_id'], ['luna_registration_receipts', 'customer_id'],
]

// SQL steps in order, each a list of statements small enough for one request.
// Every step can run again: logs are INSERT OR IGNORE and moves read the log.
export function tutorMergeSql(plan: MergePlan, scope: { tenantId: string; moduleId: string; batchId: string; now: number }, chunk = 400): { step: string; sql: string }[] {
  const { tenantId: t, moduleId: m, batchId: b, now } = scope
  const where = `tenant_id=${q(t)} AND module_id=${q(m)}`
  const merged = `(SELECT row_id FROM client_merge_log WHERE ${where} AND batch_id=${q(b)} AND role='merged')`
  const into = (column: string, table: string) => `(SELECT into_client_id FROM client_merge_log l WHERE l.tenant_id=${q(t)} AND l.module_id=${q(m)} AND l.batch_id=${q(b)} AND l.role='merged' AND l.row_id=${table}.${column})`
  const kept = `(SELECT row_id FROM client_merge_log WHERE ${where} AND batch_id=${q(b)} AND role='kept')`
  const steps: { step: string; sql: string }[] = []
  const slices = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / chunk) }, (_, i) => list.slice(i * chunk, (i + 1) * chunk))
  for (const part of slices(plan.merged)) steps.push({ step: 'log merged', sql: `INSERT OR IGNORE INTO client_merge_log(tenant_id,module_id,batch_id,role,row_id,into_client_id,snapshot_json,created_at_ms)
SELECT c.tenant_id,c.module_id,${q(b)},'merged',c.id,v.column2,${SNAPSHOT_CLIENT},${now} FROM (VALUES ${part.map(r => `(${q(r.id)},${q(r.into)})`).join(',')}) v JOIN clients c ON c.tenant_id=${q(t)} AND c.module_id=${q(m)} AND c.id=v.column1;` })
  steps.push({ step: 'log kept', sql: `INSERT OR IGNORE INTO client_merge_log(tenant_id,module_id,batch_id,role,row_id,into_client_id,snapshot_json,created_at_ms)
SELECT c.tenant_id,c.module_id,${q(b)},'kept',c.id,NULL,${SNAPSHOT_CLIENT},${now} FROM clients c WHERE c.tenant_id=${q(t)} AND c.module_id=${q(m)} AND c.id IN (SELECT into_client_id FROM client_merge_log WHERE ${where} AND batch_id=${q(b)} AND role='merged');` })
  for (const part of slices(plan.placeholderPets)) steps.push({ step: 'archive placeholder pets', sql: `INSERT OR IGNORE INTO client_merge_log(tenant_id,module_id,batch_id,role,row_id,into_client_id,snapshot_json,created_at_ms)
SELECT p.tenant_id,p.module_id,${q(b)},'pet',p.id,NULL,${SNAPSHOT_PET},${now} FROM pets p WHERE p.tenant_id=${q(t)} AND p.module_id=${q(m)} AND p.id IN (SELECT value FROM json_each(${q(JSON.stringify(part))}));
UPDATE pets SET status='inactive',updated_at_ms=${now} WHERE ${where} AND id IN (SELECT value FROM json_each(${q(JSON.stringify(part))})) AND status<>'inactive';` })
  steps.push({ step: 'move pets', sql: `INSERT OR IGNORE INTO client_merge_log(tenant_id,module_id,batch_id,role,row_id,into_client_id,snapshot_json,created_at_ms)
SELECT p.tenant_id,p.module_id,${q(b)},'pet',p.id,${into('client_id', 'p')},${SNAPSHOT_PET},${now} FROM pets p WHERE p.tenant_id=${q(t)} AND p.module_id=${q(m)} AND p.client_id IN ${merged};
UPDATE pets SET client_id=${into('client_id', 'pets')},updated_at_ms=${now} WHERE ${where} AND client_id IN ${merged};` })
  steps.push({ step: 'move history', sql: [
    ...CLIENT_REFERENCES.map(([table, column]) => `UPDATE ${table} SET ${column}=${into(column, table)} WHERE ${where} AND ${column} IN ${merged};`),
    // One portal access per tutor: the kept one wins.
    `UPDATE OR IGNORE petshop_growth_portal_access SET client_id=${into('client_id', 'petshop_growth_portal_access')} WHERE ${where} AND client_id IN ${merged};`,
    `DELETE FROM petshop_growth_portal_access WHERE ${where} AND client_id IN ${merged};`,
  ].join('\n') })
  const updates = plan.kept.map(k => `UPDATE clients SET ${Object.entries(k.set).map(([field, value]) => `${field}=${q(value)}`).join(',')},updated_at_ms=${now} WHERE ${where} AND id=${q(k.id)};`)
  for (const part of slices(updates)) steps.push({ step: 'fill kept tutors', sql: part.join('\n') })
  // Two point ledgers become one: each balance is the running sum again.
  steps.push({ step: 'loyalty balances', sql: `UPDATE loyalty_points SET balance_after=(SELECT SUM(l2.points_delta) FROM loyalty_points l2 WHERE l2.tenant_id=loyalty_points.tenant_id AND l2.module_id=loyalty_points.module_id AND l2.client_id=loyalty_points.client_id
  AND (l2.created_at_ms<loyalty_points.created_at_ms OR (l2.created_at_ms=loyalty_points.created_at_ms AND l2.id<=loyalty_points.id))) WHERE ${where} AND client_id IN ${kept};` })
  steps.push({ step: 'delete placeholder pets', sql: `DELETE FROM pets WHERE ${where} AND id IN (SELECT row_id FROM client_merge_log WHERE ${where} AND batch_id=${q(b)} AND role='pet' AND into_client_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id=pets.tenant_id AND a.module_id=pets.module_id AND a.pet_id=pets.id)
  AND NOT EXISTS (SELECT 1 FROM chat_threads a WHERE a.tenant_id=pets.tenant_id AND a.module_id=pets.module_id AND a.pet_id=pets.id)
  AND NOT EXISTS (SELECT 1 FROM client_subscriptions a WHERE a.tenant_id=pets.tenant_id AND a.module_id=pets.module_id AND a.pet_id=pets.id)
  AND NOT EXISTS (SELECT 1 FROM luna_registration_receipts a WHERE a.tenant_id=pets.tenant_id AND a.module_id=pets.module_id AND a.pet_id=pets.id);` })
  steps.push({ step: 'delete merged tutors', sql: `DELETE FROM clients WHERE ${where} AND id IN ${merged};` })
  for (const part of slices(plan.normalized)) {
    const values = part.map(r => `(${q(r.id)},${q(r.document)})`).join(',')
    steps.push({ step: 'restore CPF zeros', sql: `INSERT OR IGNORE INTO client_merge_log(tenant_id,module_id,batch_id,role,row_id,into_client_id,snapshot_json,created_at_ms)
SELECT c.tenant_id,c.module_id,${q(b)},'normalized',c.id,NULL,${SNAPSHOT_CLIENT},${now} FROM (VALUES ${values}) v JOIN clients c ON c.tenant_id=${q(t)} AND c.module_id=${q(m)} AND c.id=v.column1;
UPDATE clients SET document=(SELECT v.column2 FROM (VALUES ${values}) v WHERE v.column1=clients.id),updated_at_ms=${now} WHERE ${where} AND id IN (SELECT column1 FROM (VALUES ${values}));` })
  }
  return steps
}
