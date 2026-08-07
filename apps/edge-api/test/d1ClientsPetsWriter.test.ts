import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  ClientsPetsWriterError,
  writeClientsPetsSnapshot,
} from '../src/migration/d1ClientsPetsWriter'

const testEnv = env as EdgeEnv & { DB: D1Database }

async function seedTenant(id: string) {
  const now = Date.now()
  await testEnv.DB.prepare(`
    INSERT INTO tenants (id, slug, name, status, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).bind(id, id, id, now, now).run()
}

function clientData(tenantId: string, id = 'client-1') {
  return {
    tenant_id: tenantId,
    module_id: 'petshop',
    id,
    name: 'Maria',
    document: '12345678900',
    phone: '32999990000',
    email: 'maria@example.com',
    birth_date: null,
    address: 'Rua Um',
    address_number: '10',
    address_complement: null,
    address_reference: null,
    neighborhood: 'Centro',
    city: 'Muriae',
    postal_code: '36880000',
    notes: null,
    status: 'active' as const,
  }
}

function petData(tenantId: string, id = 'pet-1', clientId = 'client-1') {
  return {
    tenant_id: tenantId,
    module_id: 'petshop',
    id,
    client_id: clientId,
    name: 'Thor',
    species: 'dog' as const,
    breed: 'Shih Tzu',
    birth_date: null,
    weight_kg: 8.4,
    color: 'Branco',
    notes: null,
    status: 'active' as const,
  }
}

function snapshot(tenantId: string, options: {
  clients?: ReturnType<typeof clientData>[]
  pets?: ReturnType<typeof petData>[]
} = {}) {
  const clients = options.clients ?? [clientData(tenantId)]
  const pets = options.pets ?? [petData(tenantId)]
  return {
    projection: { name: 'phase7-clients-pets', version: 1 },
    source: { system: 'supabase', snapshot_id: `snapshot-${tenantId}` },
    scope: { tenant_id: tenantId, module_id: 'petshop' },
    collections: {
      clients: clients.map((data) => ({
        key: `client:${tenantId}:petshop:${data.id}`,
        data,
      })),
      pets: pets.map((data) => ({
        key: `pet:${tenantId}:petshop:${data.id}`,
        data,
      })),
    },
  }
}

describe('D1 clients/pets migration writer', () => {
  it('insere tutor e pet preservando o vínculo normalizado', async () => {
    const tenantId = 'tenant-writer-happy'
    await seedTenant(tenantId)

    const result = await writeClientsPetsSnapshot({
      database: testEnv.DB,
      snapshot: snapshot(tenantId),
      nowMs: 1000,
    })

    expect(result).toEqual({
      status: 'applied_or_already_present',
      tenantId,
      moduleId: 'petshop',
      clientCount: 1,
      petCount: 1,
      groupCount: 1,
    })

    const pet = await testEnv.DB.prepare(`
      SELECT client_id, name, species FROM pets
      WHERE tenant_id = ? AND module_id = 'petshop' AND id = 'pet-1'
    `).bind(tenantId).first<{ client_id: string; name: string; species: string }>()
    expect(pet).toEqual({ client_id: 'client-1', name: 'Thor', species: 'dog' })
  })

  it('é idempotente e não altera timestamps físicos no rerun exato', async () => {
    const tenantId = 'tenant-writer-idempotent'
    await seedTenant(tenantId)
    const input = snapshot(tenantId)

    await writeClientsPetsSnapshot({ database: testEnv.DB, snapshot: input, nowMs: 2000 })
    await writeClientsPetsSnapshot({ database: testEnv.DB, snapshot: input, nowMs: 9000 })

    const client = await testEnv.DB.prepare(`
      SELECT created_at_ms, updated_at_ms FROM clients
      WHERE tenant_id = ? AND module_id = 'petshop' AND id = 'client-1'
    `).bind(tenantId).first<{ created_at_ms: number; updated_at_ms: number }>()
    const pet = await testEnv.DB.prepare(`
      SELECT created_at_ms, updated_at_ms FROM pets
      WHERE tenant_id = ? AND module_id = 'petshop' AND id = 'pet-1'
    `).bind(tenantId).first<{ created_at_ms: number; updated_at_ms: number }>()

    expect(client).toEqual({ created_at_ms: 2000, updated_at_ms: 2000 })
    expect(pet).toEqual({ created_at_ms: 2000, updated_at_ms: 2000 })
  })

  it('rejeita conflito sem sobrescrever o destino', async () => {
    const tenantId = 'tenant-writer-conflict'
    await seedTenant(tenantId)
    const original = snapshot(tenantId)
    await writeClientsPetsSnapshot({ database: testEnv.DB, snapshot: original, nowMs: 3000 })

    const conflictingClient = { ...clientData(tenantId), phone: '32988881111' }
    await expect(writeClientsPetsSnapshot({
      database: testEnv.DB,
      snapshot: snapshot(tenantId, { clients: [conflictingClient] }),
      nowMs: 4000,
    })).rejects.toMatchObject({
      name: 'ClientsPetsWriterError',
      code: 'CLIENTS_PETS_WRITE_REJECTED',
    })

    const row = await testEnv.DB.prepare(`
      SELECT phone FROM clients
      WHERE tenant_id = ? AND module_id = 'petshop' AND id = 'client-1'
    `).bind(tenantId).first<{ phone: string }>()
    expect(row?.phone).toBe('32999990000')
  })

  it('faz rollback do tutor quando um pet do mesmo grupo conflita', async () => {
    const tenantId = 'tenant-writer-group-rollback'
    await seedTenant(tenantId)

    const now = Date.now()
    await testEnv.DB.prepare(`
      INSERT INTO clients (
        tenant_id, module_id, id, name, status, created_at_ms, updated_at_ms
      ) VALUES (?, 'petshop', 'existing-client', 'Existing', 'active', ?, ?)
    `).bind(tenantId, now, now).run()
    await testEnv.DB.prepare(`
      INSERT INTO pets (
        tenant_id, module_id, id, client_id, name, species, status, created_at_ms, updated_at_ms
      ) VALUES (?, 'petshop', 'pet-conflict', 'existing-client', 'Existing pet', 'dog', 'active', ?, ?)
    `).bind(tenantId, now, now).run()

    const newClient = clientData(tenantId, 'new-client')
    const conflictingPet = petData(tenantId, 'pet-conflict', 'new-client')

    await expect(writeClientsPetsSnapshot({
      database: testEnv.DB,
      snapshot: snapshot(tenantId, { clients: [newClient], pets: [conflictingPet] }),
      nowMs: 5000,
    })).rejects.toBeInstanceOf(ClientsPetsWriterError)

    const inserted = await testEnv.DB.prepare(`
      SELECT id FROM clients
      WHERE tenant_id = ? AND module_id = 'petshop' AND id = 'new-client'
    `).bind(tenantId).first()
    expect(inserted).toBeNull()
  })

  it('rejeita registros extras já existentes no escopo', async () => {
    const tenantId = 'tenant-writer-extra'
    await seedTenant(tenantId)
    const now = Date.now()
    await testEnv.DB.prepare(`
      INSERT INTO clients (
        tenant_id, module_id, id, name, status, created_at_ms, updated_at_ms
      ) VALUES (?, 'petshop', 'extra-client', 'Extra', 'active', ?, ?)
    `).bind(tenantId, now, now).run()

    await expect(writeClientsPetsSnapshot({
      database: testEnv.DB,
      snapshot: snapshot(tenantId),
      nowMs: 6000,
    })).rejects.toMatchObject({ code: 'CLIENTS_PETS_WRITE_REJECTED' })
  })

  it('rejeita um tutor com pets demais para um batch conservador', async () => {
    const tenantId = 'tenant-writer-large-group'
    await seedTenant(tenantId)
    const pets = Array.from({ length: 24 }, (_, index) => (
      petData(tenantId, `pet-${index}`, 'client-1')
    ))

    await expect(writeClientsPetsSnapshot({
      database: testEnv.DB,
      snapshot: snapshot(tenantId, { pets }),
      nowMs: 7000,
    })).rejects.toMatchObject({ code: 'CLIENT_GROUP_TOO_LARGE' })

    const count = await testEnv.DB.prepare(`
      SELECT COUNT(*) AS count FROM clients
      WHERE tenant_id = ? AND module_id = 'petshop'
    `).bind(tenantId).first<{ count: number }>()
    expect(count?.count).toBe(0)
  })
})