import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const testEnv = env as EdgeEnv & { DB: D1Database }

async function seedTenant(id: string) {
  const now = Date.now()
  await testEnv.DB.prepare(`
    INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).bind(id, id, id, now, now).run()
}

async function insertClient(input: {
  tenantId: string
  moduleId?: string
  id: string
  name?: string
}) {
  const now = Date.now()
  return testEnv.DB.prepare(`
    INSERT INTO clients (
      tenant_id, module_id, id, name, status, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(
    input.tenantId,
    input.moduleId ?? 'petshop',
    input.id,
    input.name ?? 'Tutor',
    now,
    now,
  ).run()
}

async function insertPet(input: {
  tenantId: string
  moduleId?: string
  id: string
  clientId: string
}) {
  const now = Date.now()
  return testEnv.DB.prepare(`
    INSERT INTO pets (
      tenant_id, module_id, id, client_id, name, species, status, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'Thor', 'dog', 'active', ?, ?)
  `).bind(
    input.tenantId,
    input.moduleId ?? 'petshop',
    input.id,
    input.clientId,
    now,
    now,
  ).run()
}

describe('clients + pets D1 ownership', () => {
  it('aceita pet ligado ao tutor no mesmo tenant e módulo', async () => {
    const tenantId = 'tenant-clients-pets-happy'
    await seedTenant(tenantId)
    await insertClient({ tenantId, id: 'client-happy' })

    await expect(insertPet({
      tenantId,
      id: 'pet-happy',
      clientId: 'client-happy',
    })).resolves.toMatchObject({ success: true })
  })

  it('rejeita vínculo de pet com tutor de outro tenant', async () => {
    const ownerTenantId = 'tenant-clients-pets-owner'
    const foreignTenantId = 'tenant-clients-pets-foreign'
    await seedTenant(ownerTenantId)
    await seedTenant(foreignTenantId)
    await insertClient({ tenantId: ownerTenantId, id: 'client-cross-tenant' })

    await expect(insertPet({
      tenantId: foreignTenantId,
      id: 'pet-cross-tenant',
      clientId: 'client-cross-tenant',
    })).rejects.toThrow()
  })

  it('rejeita vínculo de pet com tutor de outro módulo', async () => {
    const tenantId = 'tenant-clients-pets-module'
    await seedTenant(tenantId)
    await insertClient({ tenantId, moduleId: 'petshop', id: 'client-cross-module' })

    await expect(insertPet({
      tenantId,
      moduleId: 'retail',
      id: 'pet-cross-module',
      clientId: 'client-cross-module',
    })).rejects.toThrow()
  })

  it('permite o mesmo id lógico em tenants diferentes sem colisão', async () => {
    const tenantA = 'tenant-clients-pets-a'
    const tenantB = 'tenant-clients-pets-b'
    await seedTenant(tenantA)
    await seedTenant(tenantB)

    await insertClient({ tenantId: tenantA, id: 'shared-id', name: 'Tutor A' })
    await insertClient({ tenantId: tenantB, id: 'shared-id', name: 'Tutor B' })

    const rows = await testEnv.DB.prepare(`
      SELECT tenant_id, name
      FROM clients
      WHERE id = ?
      ORDER BY tenant_id
    `).bind('shared-id').all<{ tenant_id: string; name: string }>()

    expect(rows.results).toEqual([
      { tenant_id: tenantA, name: 'Tutor A' },
      { tenant_id: tenantB, name: 'Tutor B' },
    ])
  })
})