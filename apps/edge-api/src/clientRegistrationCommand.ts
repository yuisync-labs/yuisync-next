type Fields = Record<string, unknown>
const text = (v: unknown) => String(v ?? '').trim()
const nullable = (v: unknown) => text(v) || null
export const normalizePetSpecies = (v: unknown) => ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(text(v).toLowerCase()) ? text(v).toLowerCase() : 'other'

// Shared native command used by the client API and the phone-bound agent.
// Authorization and proposal confirmation belong to their respective callers.
export function clientRegistrationStatements(db: D1Database, input: { tenantId: string; moduleId: string; clientId: string; petId: string; existingClient: boolean; fields: Fields; now: number; uniquePhone?: boolean; uniquePet?: boolean }): D1PreparedStatement[] {
  const { tenantId, moduleId, clientId, petId, existingClient, fields: b, now } = input
  const statements: D1PreparedStatement[] = []
  if (!existingClient) statements.push(db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,document,phone,email,birth_date,address,address_number,address_complement,address_reference,neighborhood,city,postal_code,notes,status,created_at_ms,updated_at_ms)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'active',?17,?17
    WHERE ?18=0 OR NOT EXISTS(SELECT 1 FROM clients WHERE tenant_id=?1 AND module_id=?2 AND status='active' AND (phone=?6 OR phone='+'||?6))`)
    .bind(tenantId,moduleId,clientId,text(b.owner_name),nullable(b.owner_cpf),nullable(b.phone),nullable(b.email),nullable(b.tutor_birth_date),nullable(b.owner_address),nullable(b.address_number),nullable(b.address_complement),nullable(b.address_reference),nullable(b.owner_neighborhood),nullable(b.owner_city),nullable(b.zip_code),nullable(b.client_notes),now,input.uniquePhone ? 1 : 0))
  statements.push(db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'active',?12,?12
    WHERE ?13=0 OR NOT EXISTS(SELECT 1 FROM pets WHERE tenant_id=?1 AND module_id=?2 AND client_id=?4 AND status='active' AND name=?5 COLLATE NOCASE)`)
    .bind(tenantId,moduleId,petId,clientId,text(b.pet_name),normalizePetSpecies(b.species),nullable(b.breed),nullable(b.birth_date),b.weight_kg === '' || b.weight_kg == null ? null : Number(b.weight_kg),nullable(b.color),nullable(b.notes),now,input.uniquePet ? 1 : 0))
  return statements
}
