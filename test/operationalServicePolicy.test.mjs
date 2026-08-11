import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  defaultServiceCommissionRate,
  serviceFitsPetSpecies,
  serviceFitsPetWeight,
  serviceSpeciesTarget,
  serviceWeightRange,
} from '../src/modules/petshop/lib/appointmentServices.js'
import {
  appointmentCommissionLines,
  hydrateLegacyCommissionAppointment,
} from '../src/modules/petshop/lib/teamCommissionSummary.js'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('service policy defaults to 10% for tosa and 5% for other services', () => {
  assert.equal(defaultServiceCommissionRate({ name: 'Tosa higiênica' }), 10)
  assert.equal(defaultServiceCommissionRate({ name: 'Tosa na máquina' }), 10)
  assert.equal(defaultServiceCommissionRate({ name: 'Banho porte pequeno' }), 5)
  assert.equal(defaultServiceCommissionRate({ name: 'Escovação' }), 5)
})

test('explicit species and weight policy is reusable outside Agenda JSX', () => {
  const dogSmall = {
    name: 'Banho pequeno',
    species_target: 'dog',
    min_weight_kg: 0,
    max_weight_kg: 10,
  }

  assert.equal(serviceSpeciesTarget(dogSmall), 'dog')
  assert.equal(serviceFitsPetSpecies(dogSmall, 'dog'), true)
  assert.equal(serviceFitsPetSpecies(dogSmall, 'cat'), false)
  assert.deepEqual(serviceWeightRange(dogSmall), {
    min: 0,
    max: 10,
    minExclusive: false,
    source: 'configured',
  })
  assert.equal(serviceFitsPetWeight(dogSmall, 8), true)
  assert.equal(serviceFitsPetWeight(dogSmall, 12), false)
})

test('historical appointment commission snapshot wins over current catalog rate', () => {
  const appointment = {
    id: 'appointment-1',
    service_group: 'banho_tosa',
    service_items: [{
      code: 'banho_pequeno',
      name: 'Banho pequeno',
      group_type: 'banho_tosa',
      unit_price: 50,
      catalog_price: 50,
      commission_rate: 5,
    }],
  }
  const catalog = [{
    code: 'banho_pequeno',
    name: 'Banho pequeno',
    group_type: 'banho_tosa',
    default_price: 50,
    commission_rate: 8,
  }]

  const hydrated = hydrateLegacyCommissionAppointment(appointment, catalog)
  const [line] = appointmentCommissionLines(hydrated)
  assert.equal(hydrated.service_items[0].commission_rate, 5)
  assert.equal(line.commission_rate, 5)
  assert.equal(line.commission, 2.5)
})

test('current catalog commission is fallback only for legacy rows without snapshot', () => {
  const appointment = {
    id: 'legacy-appointment',
    service_group: 'banho_tosa',
    service_items: [{
      code: 'banho_pequeno',
      name: 'Banho pequeno',
      group_type: 'banho_tosa',
      unit_price: 50,
    }],
  }
  const catalog = [{
    code: 'banho_pequeno',
    name: 'Banho pequeno',
    group_type: 'banho_tosa',
    default_price: 50,
    commission_rate: 8,
  }]

  const hydrated = hydrateLegacyCommissionAppointment(appointment, catalog)
  const [line] = appointmentCommissionLines(hydrated)
  assert.equal(hydrated.service_items[0].commission_rate, 8)
  assert.equal(line.commission_rate, 8)
  assert.equal(line.commission, 4)
})

test('v24 schema stores operational policy and immutable appointment snapshots', async () => {
  const migration = await read('apps/edge-api/migrations/0024_operational_service_policy.sql')

  assert.match(migration, /ALTER TABLE services ADD COLUMN min_weight_kg REAL/)
  assert.match(migration, /ALTER TABLE services ADD COLUMN max_weight_kg REAL/)
  assert.match(migration, /ALTER TABLE services ADD COLUMN species_target TEXT/)
  assert.match(migration, /ALTER TABLE appointment_services ADD COLUMN commission_basis_points INTEGER/)
  assert.match(migration, /ALTER TABLE appointment_services ADD COLUMN catalog_price_cents INTEGER/)
  assert.match(migration, /appointments_scope_operation_key_unique/)
  assert.match(migration, /SET value='24'/)
})

test('service rules use a native API instead of writing operational rules from JSX', async () => {
  const page = await read('src/modules/petshop/pages/ServicosPage.jsx')
  const hook = await read('src/modules/petshop/hooks/usePetshopAdvanced.js')
  const api = await read('apps/edge-api/src/petshopServicesApi.ts')

  assert.doesNotMatch(page, /supabase\.from\(/)
  assert.match(hook, /updatePetshopServiceRules/)
  assert.match(api, /UPDATE services/)
  assert.match(api, /commission_basis_points/)
  assert.match(api, /species_target/)
})

test('appointment booking is deduplicated by canonical intent outside Agenda JSX', async () => {
  const command = await read('apps/edge-api/src/appointmentBookingIdempotency.ts')
  const compat = await read('apps/edge-api/src/compatApi.ts')

  assert.match(command, /canonicalIntent/)
  assert.match(command, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(command, /deterministicAppointmentId/)
  assert.match(command, /existingAppointment/)
  assert.match(command, /idempotent: true/)
  assert.match(command, /resolveServiceSnapshots/)
  assert.match(command, /SERVICE_SPECIES_MISMATCH/)
  assert.match(command, /SERVICE_WEIGHT_MISMATCH/)
  assert.match(command, /persistOperationalSnapshots/)
  assert.match(compat, /handleIdempotentAppointmentBooking/)
})
