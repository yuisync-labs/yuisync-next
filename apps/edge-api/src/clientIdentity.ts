// Who is the same tutor. Shared by the client APIs, Luna and the duplicate
// merge, so all three agree.

// A spreadsheet import drops a CPF's leading zeros ("5250357610"). The CPF is
// the 11 digits that pass the check digits, zeros restored; anything else
// (RG, CNPJ, typos) is not a CPF.
export function cpfKey(document: unknown): string | null {
  const digits = String(document ?? '').replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 11) return null
  const cpf = digits.padStart(11, '0')
  if (/^(\d)\1{10}$/.test(cpf)) return null
  for (const size of [9, 10]) {
    let sum = 0
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i)
    if ((sum * 10) % 11 % 10 !== Number(cpf[size])) return null
  }
  return cpf
}

// The same CPF however it was typed: digits, with or without dots, zeros lost.
export const sqlCpfDigits = (column: string) =>
  `substr('00000000000'||replace(replace(replace(replace(COALESCE(${column},''),'.',''),'-',''),' ',''),'/',''),-11)`

const tokens = (name: unknown) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(word => word && !['de', 'da', 'do', 'das', 'dos', 'e'].includes(word))
  // "Alesandra" and "Alessandra" are one spelling.
  .map(word => word.replace(/(.)\1+/g, '$1'))

// Two names are one person when they share the first name and the shorter
// name's words all appear in the longer one: "JOAO" and "Joao Pedro",
// "ANA" and "ANA MARIA SOUZA". "Marta" and "Joao" are not.
export function compatibleNames(a: unknown, b: unknown): boolean {
  const x = tokens(a), y = tokens(b)
  if (!x.length || !y.length || x[0] !== y[0]) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.every(word => long.includes(word))
}

export function samePerson(names: unknown[]): boolean {
  if (!names.length) return false
  return names.every(a => names.every(b => compatibleNames(a, b)))
}

// The active tutor with this CPF, however the CPF was stored.
export async function tutorByCpf(db: D1Database, scope: { tenantId: string; moduleId: string }, document: unknown): Promise<string | null> {
  const cpf = cpfKey(document)
  if (!cpf) return null
  const row = await db.prepare(`SELECT id FROM clients WHERE tenant_id=?1 AND module_id=?2 AND status='active'
      AND COALESCE(document,'')<>'' AND ${sqlCpfDigits('document')}=?3 ORDER BY updated_at_ms DESC,id LIMIT 1`)
    .bind(scope.tenantId, scope.moduleId, cpf).first<{ id: string }>()
  return row?.id ?? null
}
