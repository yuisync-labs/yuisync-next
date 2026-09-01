import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { attachNormalizedAppointmentClients, projectNormalizedSupabaseClientsPets } from '../scripts/migration/normalizedClientsPetsIntake.mjs'

const tenant_id = 'tenant-1'
const module_id = 'petshop'
const scoped = (row) => ({ tenant_id, module_id, ...row })

describe('normalized clients/pets appointment links', () => {
  it('uses an explicit appointment link when owner name and phone are duplicated', () => {
    const result = projectNormalizedSupabaseClientsPets({
      scope: { tenant_id, module_id },
      clients: [
        scoped({ id: 'client-1', name: 'Tutor', phone: '32999990000' }),
        scoped({ id: 'client-2', name: 'Tutor', phone: '32999990000' }),
      ],
      pets: [scoped({ id: 'pet-1', pet_name: 'Pet', owner_name: 'Tutor', phone: '32999990000' })],
      appointments: [scoped({ id: 'appointment-1', pet_id: 'pet-1', client_id: 'client-2' })],
    })

    assert.equal(result.pets[0].client_id, 'client-2')
    assert.deepEqual(result.diagnostics.appointment_client_matches, ['pet-1'])
    assert.deepEqual(result.diagnostics.fallback_owner_matches, [])
  })

  it('fails closed when appointment history points to multiple clients', () => {
    assert.throws(
      () => projectNormalizedSupabaseClientsPets({
        scope: { tenant_id, module_id },
        clients: [
          scoped({ id: 'client-1', name: 'Tutor', phone: '32999990000' }),
          scoped({ id: 'client-2', name: 'Tutor', phone: '32999990000' }),
        ],
        pets: [scoped({ id: 'pet-1', pet_name: 'Pet', owner_name: 'Tutor', phone: '32999990000' })],
        appointments: [
          scoped({ id: 'appointment-1', pet_id: 'pet-1', client_id: 'client-1' }),
          scoped({ id: 'appointment-2', pet_id: 'pet-1', client_id: 'client-2' }),
        ],
      }),
      (error) => error?.code === 'PET_APPOINTMENT_CLIENT_AMBIGUOUS',
    )
  })
})

describe('canonical appointment client inference', () => {
  it('fills only missing client ids from the normalized pet owner', () => {
    const result = attachNormalizedAppointmentClients({
      pets:[{ id:'pet-1',client_id:'client-1' },{ id:'pet-2',client_id:'client-2' }],
      appointments:[{ id:'a1',pet_id:'pet-1',client_id:'' },{ id:'a2',pet_id:'pet-2',client_id:'explicit-client' }],
    })
    assert.equal(result.inferred_client_ids, 1)
    assert.equal(result.appointments[0].client_id, 'client-1')
    assert.equal(result.appointments[1].client_id, 'explicit-client')
  })
})
