import { describe, expect, it } from 'vitest'

import { compatibleNames, cpfKey, samePerson } from '../src/clientIdentity'
import { phoneKey, planTutorMerge, type MergeClient } from '../src/clientMerge'

const client = (id: string, fields: Partial<MergeClient>): MergeClient => ({
  id, name: 'X', document: null, phone: null, email: null, birth_date: null, address: null, address_number: null, address_complement: null,
  address_reference: null, neighborhood: null, city: null, postal_code: null, notes: null, status: 'active', created_at_ms: 1, updated_at_ms: 1, ...fields,
})

describe('same tutor', () => {
  it('reads a CPF however it was stored', () => {
    expect(cpfKey('052.503.576-10')).toBe('05250357610')
    expect(cpfKey('5250357610')).toBe('05250357610')
    expect(cpfKey('05250357611')).toBeNull()
    expect(cpfKey('11222333000181')).toBeNull()
  })
  it('treats a short name as the full name of the same person', () => {
    expect(compatibleNames('JOAO', 'Joao Pedro Lima Santos')).toBe(true)
    expect(compatibleNames('BRUNA OLIVEIRA COSTA', 'BRUNA DE OLIVEIRA COSTA')).toBe(true)
    expect(compatibleNames('ALESANDRA REIS', 'ALESSANDRA REIS')).toBe(true)
    expect(compatibleNames('Marta Ramos', 'Joao Pedro')).toBe(false)
    expect(compatibleNames('Maria Silva', 'Maria Souza')).toBe(false)
    expect(samePerson(['JOAO', 'JOAO PEDRO'])).toBe(true)
  })
  it('reads one phone with or without 55 and the 9', () => {
    expect(phoneKey('551191234567')).toBe(phoneKey('11991234567'))
    expect(phoneKey('+55 11 99123-4567')).toBe('1191234567')
    expect(phoneKey('3')).toBeNull()
  })
})

describe('duplicate tutor plan', () => {
  it('joins one CPF and one phone into the tutor with history, and drops the placeholder pet', () => {
    const clients = [
      client('a', { name: 'JOAO PEDRO', document: '05250357610', phone: '11991234567', created_at_ms: 1 }),
      client('b', { name: 'Joao Pedro Lima Santos', document: '052.503.576-10', phone: '11990000000', birth_date: '1990-01-15', notes: 'perto da praca' }),
      client('c', { name: 'JOAO', phone: '551191234567' }),
      client('d', { name: 'Marta Ramos', document: '05250357610' }),
      client('e', { name: 'JOAO PEDRO', document: '5250357610', status: 'inactive' }),
      client('f', { name: 'Outra Pessoa', phone: '11991234567' }),
    ]
    const pets = [{ id: 'p1', client_id: 'a', name: 'Pipoca' }, { id: 'p2', client_id: 'b', name: 'Max' }, { id: 'p3', client_id: 'e', name: 'JOAO PEDRO' }]
    const plan = planTutorMerge(clients, pets, { a: 11, b: 1 })
    expect(plan.merged.sort((x, y) => x.id.localeCompare(y.id))).toEqual([{ id: 'b', into: 'a' }, { id: 'c', into: 'a' }, { id: 'e', into: 'a' }])
    expect(plan.kept).toEqual([{ id: 'a', set: { name: 'Joao Pedro Lima Santos', birth_date: '1990-01-15', notes: 'perto da praca' } }])
    expect(plan.placeholderPets).toEqual(['p3'])
    expect(plan.conflicts).toEqual([{ cpf: '05250357610', kept: 'a', other: ['d'] }])
  })
})
