import { describe, expect, it } from 'vitest'

import {
  ClientsPetsProjectionError,
  projectD1ClientsPets,
  projectSupabaseClientsPets,
} from '../scripts/migration/phase7ClientsPetsProjection.mjs'

const scope = { tenant_id: 'tenant-test', module_id: 'petshop' }

function legacyClient(overrides = {}) {
  return {
    id: 'legacy-pet-1',
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    name: 'Maria Tutor',
    document: '123.456.789-00',
    phone: '(32) 99999-0000',
    email: 'MARIA@EXAMPLE.COM',
    address: 'Rua Um',
    neighborhood: 'Centro',
    city: 'Muriae',
    notes: 'Tutor prefere contato por WhatsApp',
    active: true,
    details: {
      pet_name: 'Thor',
      species: 'dog',
      breed: 'Shih Tzu',
      birth_date: '2022-01-02',
      weight_kg: 8.4,
      color: 'Branco',
      tutor_birth_date: '1990-03-04',
      zip_code: '36880-000',
      address_number: '10',
      address_complement: 'Apto 1',
      address_reference: 'Perto da praça',
      pet_notes: 'Alergia registrada',
    },
    ...overrides,
  }
}

describe('phase7 clients + pets projection', () => {
  it('normaliza uma linha legacy em tutor + pet e preserva o id como pet.id', () => {
    const projection = projectSupabaseClientsPets({
      snapshotId: 'snapshot-1',
      scope,
      clients: [legacyClient()],
    })

    expect(projection.collections.clients).toHaveLength(1)
    expect(projection.collections.pets).toHaveLength(1)
    expect(projection.collections.clients[0].data).toMatchObject({
      id: 'legacy-pet-1',
      document: '12345678900',
      phone: '32999990000',
      email: 'maria@example.com',
      postal_code: '36880000',
    })
    expect(projection.collections.pets[0].data).toMatchObject({
      id: 'legacy-pet-1',
      client_id: 'legacy-pet-1',
      name: 'Thor',
      species: 'dog',
      breed: 'Shih Tzu',
      weight_kg: 8.4,
    })
  })

  it('usa apenas tutor_group_id explícito para agrupar vários pets no mesmo tutor', () => {
    const first = legacyClient({
      id: 'pet-a',
      details: { ...legacyClient().details, tutor_group_id: 'tutor-group-1', pet_name: 'Thor' },
    })
    const second = legacyClient({
      id: 'pet-b',
      details: { ...legacyClient().details, tutor_group_id: 'tutor-group-1', pet_name: 'Mel' },
    })

    const projection = projectSupabaseClientsPets({
      snapshotId: 'snapshot-group',
      scope,
      clients: [first, second],
    })

    expect(projection.collections.clients.map((record) => record.data.id)).toEqual(['tutor-group-1'])
    expect(projection.collections.pets.map((record) => record.data)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pet-a', client_id: 'tutor-group-1', name: 'Thor' }),
      expect.objectContaining({ id: 'pet-b', client_id: 'tutor-group-1', name: 'Mel' }),
    ]))
  })

  it('não funde cadastros só porque telefone e CPF coincidem', () => {
    const projection = projectSupabaseClientsPets({
      snapshotId: 'snapshot-no-guess',
      scope,
      clients: [
        legacyClient({ id: 'pet-a' }),
        legacyClient({ id: 'pet-b', details: { ...legacyClient().details, pet_name: 'Mel' } }),
      ],
    })

    expect(projection.collections.clients.map((record) => record.data.id)).toEqual(['pet-a', 'pet-b'])
  })

  it('falha fechado quando membros do mesmo grupo divergem nos dados do tutor', () => {
    const first = legacyClient({
      id: 'pet-a',
      details: { ...legacyClient().details, tutor_group_id: 'tutor-conflict' },
    })
    const second = legacyClient({
      id: 'pet-b',
      phone: '(32) 98888-1111',
      details: { ...legacyClient().details, tutor_group_id: 'tutor-conflict', pet_name: 'Mel' },
    })

    expect(() => projectSupabaseClientsPets({
      snapshotId: 'snapshot-conflict',
      scope,
      clients: [first, second],
    })).toThrowError(expect.objectContaining({
      name: 'ClientsPetsProjectionError',
      code: 'SOURCE_TUTOR_GROUP_CONFLICT',
    }))
  })

  it('rejeita linha source fora do tenant selecionado', () => {
    expect(() => projectSupabaseClientsPets({
      snapshotId: 'snapshot-cross-tenant',
      scope,
      clients: [legacyClient({ tenant_id: 'tenant-other' })],
    })).toThrowError(expect.objectContaining({ code: 'SOURCE_TENANT_SCOPE_MISMATCH' }))
  })

  it('rejeita pet D1 órfão mesmo antes da reconciliação', () => {
    expect(() => projectD1ClientsPets({
      snapshotId: 'd1-orphan',
      scope,
      clients: [],
      pets: [{
        tenant_id: scope.tenant_id,
        module_id: scope.module_id,
        id: 'pet-orphan',
        client_id: 'missing-client',
        name: 'Thor',
        species: 'dog',
        status: 'active',
      }],
    })).toThrowError(expect.objectContaining({ code: 'DESTINATION_PET_CLIENT_NOT_FOUND' }))
  })

  it('projeta D1 para a mesma forma lógica independente de timestamps físicos', () => {
    const source = projectSupabaseClientsPets({
      snapshotId: 'source-snapshot',
      scope,
      clients: [legacyClient()],
    })
    const destination = projectD1ClientsPets({
      snapshotId: 'destination-snapshot',
      scope,
      clients: [{
        ...source.collections.clients[0].data,
        created_at_ms: 1,
        updated_at_ms: 2,
      }],
      pets: [{
        ...source.collections.pets[0].data,
        created_at_ms: 3,
        updated_at_ms: 4,
      }],
    })

    expect(destination.collections).toEqual(source.collections)
  })

  it('mantém uma classe de erro específica para gates da migração', () => {
    const error = new ClientsPetsProjectionError('EXAMPLE')
    expect(error).toMatchObject({ name: 'ClientsPetsProjectionError', code: 'EXAMPLE' })
  })
})