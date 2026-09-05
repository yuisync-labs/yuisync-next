import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PETSHOP_OPERATIONAL_STAFF,
  DEFAULT_VETERINARY_BUSINESS_HOURS,
  friendlyPetshopServiceLabel,
  normalizeOperationalStaff,
  resolvePetshopServiceDuration,
} from '../shared/petshopOperations.js'

test('veterinary schedule is weekdays 13:00-18:00 and closed on weekends', () => {
  for (const weekday of [1, 2, 3, 4, 5]) {
    assert.deepEqual(DEFAULT_VETERINARY_BUSINESS_HOURS[weekday], [{ open: '13:00', close: '18:00' }])
  }
  assert.deepEqual(DEFAULT_VETERINARY_BUSINESS_HOURS[6], [])
  assert.deepEqual(DEFAULT_VETERINARY_BUSINESS_HOURS[7], [])
})

test('service durations follow the operational weight matrix', () => {
  const cases = [
    ['banho', 8, 40],
    ['tosa maquina total', 8, 60],
    ['tosa tesoura', 8, 90],
    ['banho', 10, 60],
    ['tosa maquina total', 10, 90],
    ['tosa tesoura', 10, 120],
    ['banho', 35, 60],
    ['tosa maquina total', 35, 90],
    ['tosa tesoura', 35, 120],
  ]
  for (const [name, weightKg, expected] of cases) {
    assert.equal(resolvePetshopServiceDuration({ service: name, weightKg, fallbackMin: 999 }), expected)
  }
})

test('duration presets recognize real catalog options that expose label and internal value', () => {
  const cases = [
    [{ value: '9db5b4d7-uuid', label: 'Banho Pet Porte Pequeno 0 kg a 10 kg' }, null, 40],
    [{ value: 'svc-002', label: 'Tosa Máquina/Total Porte Pequeno' }, null, 60],
    [{ value: 'svc-003', label: 'Tosa Tesoura Porte Pequeno' }, null, 90],
    [{ value: 'svc-004', label: 'Banho Porte Médio ou Grande' }, null, 60],
    [{ value: 'svc-005', label: 'Tosa Máquina/Total 10 kg ou mais' }, null, 90],
    [{ value: 'svc-006', label: 'Tosa Tesoura Porte Grande' }, null, 120],
  ]

  for (const [service, weightKg, expected] of cases) {
    assert.equal(resolvePetshopServiceDuration({ service, weightKg, fallbackMin: 777 }), expected)
  }
})

test('client weight takes precedence over size text when both are available', () => {
  assert.equal(
    resolvePetshopServiceDuration({
      service: { value: 'svc-banho', label: 'Banho geral' },
      weightKg: 8,
      fallbackMin: 777,
    }),
    40,
  )
  assert.equal(
    resolvePetshopServiceDuration({
      service: { value: 'svc-tosa', label: 'Tosa Tesoura' },
      weightKg: 18,
      fallbackMin: 777,
    }),
    120,
  )
})

test('customer-facing labels hide catalog classification details', () => {
  assert.equal(
    friendlyPetshopServiceLabel('BANHO PET PORTE PEQUENO 0 KG A 10 KG (TODAS AS PELAGENS)', { weightKg: 8 }),
    'Banho Pet Porte Pequeno',
  )
  assert.equal(
    friendlyPetshopServiceLabel('TOSA TESOURA 0 KG A 10 KG (PELO LONGO)', { weightKg: 8 }),
    'Banho e Tosa na Tesoura Porte Pequeno',
  )
})

test('operational staff preserves every configured professional beyond four', () => {
  const staff = normalizeOperationalStaff([
    ...DEFAULT_PETSHOP_OPERATIONAL_STAFF,
    { key: 'esteticista-3', name: 'Ana', active: true },
    { key: 'esteticista-4', name: 'Bia', active: false },
    { key: 'esteticista-5', name: 'Carla', active: true },
  ])
  assert.equal(staff.length, 5)
  assert.deepEqual(staff.map((person) => person.key), ['esteticista-1', 'esteticista-2', 'esteticista-3', 'esteticista-4', 'esteticista-5'])
})
