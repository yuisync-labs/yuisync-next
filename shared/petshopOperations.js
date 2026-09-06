const clean = (value = '') => String(value || '').trim()

export const DEFAULT_VETERINARY_NAME = 'Dra. Taina Campos'

export const DEFAULT_VETERINARY_BUSINESS_HOURS = {
  1: [{ open: '13:00', close: '18:00' }],
  2: [{ open: '13:00', close: '18:00' }],
  3: [{ open: '13:00', close: '18:00' }],
  4: [{ open: '13:00', close: '18:00' }],
  5: [{ open: '13:00', close: '18:00' }],
  6: [],
  7: [],
}

export const DEFAULT_PETSHOP_OPERATIONAL_STAFF = [
  { key: 'esteticista-1', name: 'Esteticista 1', active: true },
  { key: 'esteticista-2', name: 'Esteticista 2', active: true },
]

export const PETSHOP_DELIVERY_STAFF_TEMPLATE_KEY = '__petshop_delivery_staff'
export const PETSHOP_COMMISSION_RESET_TEMPLATE_KEY = '__petshop_commission_reset_at'

export const DEFAULT_PETSHOP_DELIVERY_STAFF = [
  { key: 'motoboy-1', name: 'Motoboy 1', active: true },
]

export const DEFAULT_PETSHOP_SERVICE_DURATIONS = {
  small: {
    min_weight_kg: 0,
    max_weight_kg: 9.99,
    bath_min: 40,
    machine_grooming_min: 60,
    scissor_grooming_min: 90,
  },
  medium: {
    min_weight_kg: 10,
    max_weight_kg: 999.99,
    bath_min: 60,
    machine_grooming_min: 90,
    scissor_grooming_min: 120,
  },
}

export function normalizeOperationalStaff(value = DEFAULT_PETSHOP_OPERATIONAL_STAFF) {
  const rows = Array.isArray(value) ? value : DEFAULT_PETSHOP_OPERATIONAL_STAFF
  const seen = new Set()
  return rows
    .map((item, index) => {
      const fallback = DEFAULT_PETSHOP_OPERATIONAL_STAFF[index]
      const rawKey = clean(item?.key || item?.id || fallback?.key || `esteticista-${index + 1}`)
      const key = rawKey
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `esteticista-${index + 1}`
      return {
        key,
        name: clean(item?.name || item?.full_name || fallback?.name || `Esteticista ${index + 1}`),
        active: item?.active !== false,
      }
    })
    .filter((item) => item.name && !seen.has(item.key) && seen.add(item.key))
}

export function normalizeDeliveryStaff(value = DEFAULT_PETSHOP_DELIVERY_STAFF) {
  const rows = Array.isArray(value) ? value : DEFAULT_PETSHOP_DELIVERY_STAFF
  const seen = new Set()
  return rows
    .map((item, index) => {
      const fallback = DEFAULT_PETSHOP_DELIVERY_STAFF[index]
      const rawKey = clean(item?.key || item?.id || fallback?.key || `motoboy-${index + 1}`)
      const key = rawKey
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `motoboy-${index + 1}`
      return {
        key,
        name: clean(item?.name || item?.full_name || fallback?.name || `Motoboy ${index + 1}`),
        active: item?.active !== false,
      }
    })
    .filter((item) => item.name && !seen.has(item.key) && seen.add(item.key))
}

export function normalizeServiceDurations(value = DEFAULT_PETSHOP_SERVICE_DURATIONS) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : DEFAULT_PETSHOP_SERVICE_DURATIONS
  const normalizeRange = (key) => {
    const fallback = DEFAULT_PETSHOP_SERVICE_DURATIONS[key]
    const row = source[key] || {}
    return {
      min_weight_kg: Number.isFinite(Number(row.min_weight_kg)) ? Number(row.min_weight_kg) : fallback.min_weight_kg,
      max_weight_kg: Number.isFinite(Number(row.max_weight_kg)) ? Number(row.max_weight_kg) : fallback.max_weight_kg,
      bath_min: Math.max(15, Number(row.bath_min || fallback.bath_min)),
      machine_grooming_min: Math.max(15, Number(row.machine_grooming_min || fallback.machine_grooming_min)),
      scissor_grooming_min: Math.max(15, Number(row.scissor_grooming_min || fallback.scissor_grooming_min)),
    }
  }
  return { small: normalizeRange('small'), medium: normalizeRange('medium') }
}

function normalizedServiceText(service = {}) {
  const metadata = service && typeof service === 'object' && !Array.isArray(service)
    ? (service.bot_metadata || service.metadata || {})
    : {}
  const raw = typeof service === 'string'
    ? service
    : [
      service.code,
      service.value,
      service.name,
      service.label,
      service.service_type,
      service.operation_kind,
      service.size,
      service.pet_size,
      metadata.service_kind,
      metadata.service_type,
      metadata.size,
      metadata.pet_size,
    ].filter(Boolean).join(' ')
  return clean(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function normalizedWeight(weightKg) {
  if (weightKg === null || weightKg === undefined || clean(weightKg) === '') return null
  const weight = Number(weightKg)
  return Number.isFinite(weight) && weight >= 0 ? weight : null
}

export function serviceOperationKind(service = {}) {
  const text = normalizedServiceText(service)
  if (/tesoura/.test(text)) return 'scissor_grooming'
  if (/tosa|maquina|total|groom/.test(text)) return 'machine_grooming'
  if (/banho/.test(text)) return 'bath'
  return null
}

function durationRangeForWeight(durations, weightKg) {
  const weight = normalizedWeight(weightKg)
  if (weight === null) return null
  return Object.values(normalizeServiceDurations(durations)).find((row) => (
    weight >= Number(row.min_weight_kg) && weight <= Number(row.max_weight_kg)
  )) || null
}

function durationRangeForService(durations, service, weightKg) {
  const normalizedDurations = normalizeServiceDurations(durations)
  const byWeight = durationRangeForWeight(normalizedDurations, weightKg)
  if (byWeight) return byWeight

  const text = normalizedServiceText(service)
  const smallPattern = /\bpequen[oa]\b|\bporte\s*p\b|\bate\s*10\s*kg\b|\b0\s*(?:kg)?\s*(?:a|ate|-)\s*10\s*kg\b/
  const mediumPlusPattern = /\bmedi[oa]\b|\bgrande\b|\bporte\s*(?:m|g)\b|\b10\s*kg\s*(?:ou\s*mais|acima)\b|\bacima\s*de\s*10\s*kg\b|\bmais\s*de\s*10\s*kg\b|\b10\s*(?:kg)?\s*(?:a|ate|-)\s*\d+\s*kg\b/
  if (smallPattern.test(text)) return normalizedDurations.small
  if (mediumPlusPattern.test(text)) return normalizedDurations.medium
  return null
}

export function resolvePetshopServiceDuration({ service = {}, weightKg = null, durations = DEFAULT_PETSHOP_SERVICE_DURATIONS, fallbackMin = 60 } = {}) {
  const kind = serviceOperationKind(service)
  const range = durationRangeForService(durations, service, weightKg)
  if (!kind || !range) return Math.max(15, Number(fallbackMin || 60))
  const field = kind === 'bath'
    ? 'bath_min'
    : kind === 'scissor_grooming'
      ? 'scissor_grooming_min'
      : 'machine_grooming_min'
  return Math.max(15, Number(range[field] || fallbackMin || 60))
}

function inferredSizeLabel(service = {}, weightKg = null) {
  const text = normalizedServiceText(service)
  const weight = normalizedWeight(weightKg)
  if (/pequeno|0\s*kg|ate\s*10|0\s*a\s*10/.test(text) || (weight !== null && weight < 10)) return 'Porte Pequeno'
  if (/medio|10\s*kg|10\s*a\s*22|10\s*a\s*21/.test(text) || (weight !== null && weight >= 10 && weight < 22)) return 'Porte Médio'
  if (/grande|acima\s*de\s*22|mais\s*de\s*22/.test(text) || (weight !== null && weight >= 22)) return 'Porte Grande'
  return ''
}

export function friendlyPetshopServiceLabel(service = {}, { weightKg = null } = {}) {
  const raw = clean(typeof service === 'string' ? service : service.name || service.label || service.service_type || service.code)
  if (!raw) return 'Serviço Pet'
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const size = inferredSizeLabel(service, weightKg)
  const suffix = size ? ` ${size}` : ''
  if (/consulta|veterin/.test(normalized)) return 'Consulta Veterinária'
  if (/vacina/.test(normalized)) return 'Vacina'
  if (/tesoura/.test(normalized)) return `Banho e Tosa na Tesoura${suffix}`.trim()
  if (/tosa|maquina|total/.test(normalized)) return `Banho e Tosa na Máquina${suffix}`.trim()
  if (/banho/.test(normalized)) return `Banho Pet${suffix}`.trim()
  return raw
    .replace(/\([^)]*(?:kg|pelagem|porte|classifica)[^)]*\)/gi, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*kg\s*(?:a|até|-)\s*\d+(?:[.,]\d+)?\s*kg\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
