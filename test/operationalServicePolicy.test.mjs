import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  appointmentServiceEligibility,
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

test('agenda eligibility returns one domain result with a human-readable reason', () => {
  const dogSmall = {
    name: 'Banho pequeno',
    species_target: 'dog',
    min_weight_kg: 0,
    max_weight_kg: 10,
  }

  assert.deepEqual(appointmentServiceEligibility(dogSmall, { species: 'dog', weight_kg: 8 }), {
    eligible: true,
    speciesEligible: true,
    weightEligible: true,
    reason: '',
  })

  const wrongSpecies = appointmentServiceEligibility(dogSmall, { species: 'cat', weight_kg: 8 })
  assert.equal(wrongSpecies.eligible, false)
  assert.equal(wrongSpecies.speciesEligible, false)
  assert.match(wrongSpecies.reason, /Somente cães/)

  const wrongWeight = appointmentServiceEligibility(dogSmall, { species: 'dog', weight_kg: 12 })
  assert.equal(wrongWeight.eligible, false)
  assert.equal(wrongWeight.weightEligible, false)
  assert.match(wrongWeight.reason, /0 a 10 kg/)
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

test('v24 schema stores operational policy, immutable snapshots and command identity', async () => {
  const migration = await read('apps/edge-api/migrations/0024_operational_service_policy.sql')

  assert.match(migration, /ALTER TABLE services ADD COLUMN min_weight_kg REAL/)
  assert.match(migration, /ALTER TABLE services ADD COLUMN max_weight_kg REAL/)
  assert.match(migration, /ALTER TABLE services ADD COLUMN species_target TEXT/)
  assert.match(migration, /ALTER TABLE appointment_services ADD COLUMN commission_basis_points INTEGER/)
  assert.match(migration, /ALTER TABLE appointment_services ADD COLUMN catalog_price_cents INTEGER/)
  assert.match(migration, /ALTER TABLE appointments ADD COLUMN operation_fingerprint TEXT/)
  assert.match(migration, /CREATE TABLE appointment_command_registry/)
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

test('appointment booking uses caller idempotency key as operation identity and intent as fingerprint', async () => {
  const command = await read('apps/edge-api/src/appointmentBookingIdempotency.ts')
  const compat = await read('apps/edge-api/src/compatApi.ts')
  const hook = await read('src/shared/hooks/useAppointments.js')

  assert.match(hook, /idempotency_key: payload\.idempotency_key \|\| crypto\.randomUUID\(\)/)
  assert.match(command, /const callerKey = text\(payload\.idempotency_key\) \|\| text\(payload\.operation_key\)/)
  assert.match(command, /scopedOperationIdentityHash/)
  assert.match(command, /canonicalIntent/)
  assert.match(command, /operation_fingerprint/)
  assert.match(command, /reserveBookingOperation/)
  assert.match(command, /INSERT OR IGNORE INTO appointment_command_registry/)
  assert.match(command, /IDEMPOTENCY_KEY_REUSED/)
  assert.match(command, /idempotent: true/)
  assert.match(command, /completeBookingOperation/)
  assert.match(command, /PET_CLIENT_MISMATCH/)
  assert.match(command, /SERVICE_SPECIES_MISMATCH/)
  assert.match(command, /SERVICE_WEIGHT_MISMATCH/)
  assert.match(command, /persistOperationalSnapshots/)
  assert.match(compat, /handleAppointmentCommandPolicy/)
})

test('eligibility is checked before appointment mutation and UI preserves readable feedback', async () => {
  const command = await read('apps/edge-api/src/appointmentBookingIdempotency.ts')
  const adapter = await read('src/lib/supabase.js')
  const resolveIndex = command.indexOf('const resolved = await resolveServiceSnapshots')
  const delegateIndex = command.indexOf('const delegated = await delegateOperationalRpc', resolveIndex)

  assert.ok(resolveIndex >= 0, 'booking must resolve pet/service eligibility')
  assert.ok(delegateIndex > resolveIndex, 'eligibility resolution must happen before mutation delegation')
  assert.match(adapter, /SERVICE_SPECIES_MISMATCH: 'Este serviço não está configurado para a espécie do pet selecionado\.'/)
  assert.match(adapter, /SERVICE_WEIGHT_MISMATCH: 'Este serviço não atende à faixa de peso cadastrada para o pet selecionado\.'/)
  assert.match(adapter, /compatOperationErrorMessage/)
})

test('appointment edits preserve commercial snapshots unless service or pet really changes', async () => {
  const command = await read('apps/edge-api/src/appointmentBookingIdempotency.ts')

  assert.match(command, /sameCodeSet/)
  assert.match(command, /const petChanged/)
  assert.match(command, /const serviceChanged/)
  assert.match(command, /preserveCommercialSnapshot/)
  assert.match(command, /nextPayload\.price = existing\.price/)
  assert.match(command, /snapshot_policy: preserveCommercialSnapshot \? 'preserved' : 'refreshed'/)
})

test('completed appointment reopen is transactional, package-aware and financial-safe', async () => {
  const migration = await read('apps/edge-api/migrations/0024_operational_service_policy.sql')
  const policy = await read('apps/edge-api/src/appointmentReopenPolicy.ts')
  const rpcCompat = await read('apps/edge-api/src/appointmentReopenCompat.ts')
  const queryCompat = await read('apps/edge-api/src/appointmentReopenQueryCompat.ts')
  const compat = await read('apps/edge-api/src/compatApi.ts')

  assert.match(migration, /CREATE TRIGGER appointments_reopen_blocks_active_sale/)
  assert.match(migration, /APPOINTMENT_REOPEN_SALE_BLOCKED/)
  assert.match(policy, /APPOINTMENT_REOPEN_REFUND_REQUIRED/)
  assert.match(policy, /APPOINTMENT_REOPEN_SALE_CANCEL_REQUIRED/)
  assert.match(policy, /subscription_benefit_status=\?5/)
  assert.match(policy, /status: 'released'/)
  assert.match(policy, /services_used_json=json_set/)
  assert.match(policy, /UPDATE appointment_services[\s\S]*SET benefit_used=0/)
  assert.match(policy, /live_status='aguardando'/)
  assert.match(rpcCompat, /APPOINTMENT_REOPEN_EDIT_SEPARATELY/)
  assert.match(rpcCompat, /completedAppointmentReopenFinancialBlocker/)
  assert.match(rpcCompat, /reopenCompletedAppointment/)
  assert.match(queryCompat, /table\) !== 'appointments'/)
  assert.match(queryCompat, /handleCompletedAppointmentReopenCompat/)
  assert.match(compat, /handleCompletedAppointmentReopenQueryCompat/)
  assert.match(compat, /handleCompletedAppointmentReopenCompat/)
})

test('status-only completion is promoted to command plus idempotent package reconciliation', async () => {
  const rpcCompat = await read('apps/edge-api/src/appointmentCompletionCompat.ts')
  const queryCompat = await read('apps/edge-api/src/appointmentCompletionQueryCompat.ts')
  const compat = await read('apps/edge-api/src/compatApi.ts')

  assert.match(rpcCompat, /handleAppointmentCommandPolicy/)
  assert.match(rpcCompat, /reconcile_petshop_completed_appointment_package/)
  assert.match(rpcCompat, /appointment_completed: true/)
  assert.match(rpcCompat, /retry_safe: true/)
  assert.match(rpcCompat, /package_reconciliation/)
  assert.match(queryCompat, /isAppointmentCompletionTarget/)
  assert.match(queryCompat, /update_petshop_appointment_transaction/)
  assert.match(queryCompat, /handleCompletedAppointmentCompletionCompat/)
  assert.match(compat, /handleCompletedAppointmentCompletionQueryCompat/)
  assert.match(compat, /handleCompletedAppointmentCompletionCompat/)
})

test('appointment lifecycle writes use the existing system_update_logs audit trail', async () => {
  const migration = await read('apps/edge-api/migrations/0021_deferred_compat_surface.sql')
  const audit = await read('apps/edge-api/src/appointmentOperationalAudit.ts')
  const completion = await read('apps/edge-api/src/appointmentCompletionCompat.ts')
  const reopen = await read('apps/edge-api/src/appointmentReopenPolicy.ts')

  assert.match(migration, /CREATE TABLE IF NOT EXISTS system_update_logs/)
  assert.match(audit, /INSERT OR IGNORE INTO system_update_logs/)
  assert.match(audit, /appointment-command/)
  assert.match(audit, /transition_version/)
  assert.match(completion, /eventType: 'appointment\.completed'/)
  assert.match(completion, /eventType: 'appointment\.package_consumed'/)
  assert.match(reopen, /eventType: 'appointment\.reopened'/)
  assert.match(reopen, /eventType: 'appointment\.package_released'/)
})