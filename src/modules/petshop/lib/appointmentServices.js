const stripAccents = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const VALID_APPOINTMENT_GROUPS = new Set(['banho_tosa', 'veterinaria'])
const VETERINARY_PATTERN = /\b(vet|veterin|consulta|vacina|clinica|medico|exame|cirurg|ultrassom|castr|retorno|internac|curativo|vermifug|microchip|aplicacao|hemograma|radiograf|raio[ -]?x|coleta|sorolog|odontolog|anestesia|medicacao|eletrocard|ecocard|emergencia|procedimento)\w*/
const TOSA_PATTERN = /\b(tosa|tosagem|tosar|trim|trimming|stripping|acabamento|penteado|corte (?:de|do) pelo)\w*/
const COMMISSION_TOSA_PATTERN = /\b(tosa|tosagem|tosar|trim|trimming|stripping|corte (?:de|do) pelo)\w*/
const BATH_PATTERN = /\b(banho|lavagem|secagem|secar)\w*/
const GROOMING_COMPLEMENT_PATTERN = /\b(desembolo|desembarac|escovac|hidrat|higien|perfume|spa|unha|unhas|ouvido|orelhas|patas|almofad|dente|dental|pelagem)\w*/
const CAT_PATTERN = /\b(gato|gata|gatos|gatas|felino|felina|felinos|felinas)\b/
const DOG_PATTERN = /\b(cao|caes|cachorro|cachorra|cachorros|cachorras|canino|canina|caninos|caninas)\b/

const appointmentServiceText = (service = {}) => stripAccents([
  service.code,
  service.value,
  service.name,
  service.label,
  service.category,
  service.description,
].filter(Boolean).join(' '))

const finiteWeight = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const parseWeightFromText = (text = '') => {
  const normalized = stripAccents(text).replace(/,/g, '.')
  let match = normalized.match(/\b(?:de\s*)?(\d+(?:\.\d+)?)\s*(?:kg)?\s*(?:a|ate|-)\s*(\d+(?:\.\d+)?)\s*kg\b/)
  if (match) {
    const min = finiteWeight(match[1])
    const max = finiteWeight(match[2])
    if (min !== null && max !== null && max >= min) return { min, max, source: 'text' }
  }

  match = normalized.match(/\b(?:ate|no maximo|maximo)\s*(\d+(?:\.\d+)?)\s*kg\b/)
  if (match) return { min: null, max: finiteWeight(match[1]), source: 'text' }

  match = normalized.match(/\b(?:acima de|mais de|maior que)\s*(\d+(?:\.\d+)?)\s*kg\b/)
  if (match) return { min: finiteWeight(match[1]), max: null, minExclusive: true, source: 'text' }

  return null
}

const normalizeSpecies = (value = '') => {
  const normalized = stripAccents(value)
  if (['dog', 'cao', 'caes', 'cachorro', 'cachorra', 'canino', 'canina'].includes(normalized)) return 'dog'
  if (['cat', 'gato', 'gata', 'felino', 'felina'].includes(normalized)) return 'cat'
  if (['all', 'ambos', 'ambas', 'todos', 'todas', 'both'].includes(normalized)) return 'all'
  return null
}

export function normalizeAppointmentServiceText(value = '') {
  return stripAccents(value)
}

export function defaultServiceCommissionRate(service = {}) {
  return COMMISSION_TOSA_PATTERN.test(appointmentServiceText(service)) ? 10 : 5
}

export function serviceSpeciesTarget(service = {}) {
  const hasOperationalTarget = Object.prototype.hasOwnProperty.call(service, 'species_target')
    || Object.prototype.hasOwnProperty.call(service, 'speciesTarget')
  if (hasOperationalTarget) {
    return normalizeSpecies(service.species_target ?? service.speciesTarget) || 'all'
  }

  const explicit = normalizeSpecies(service.species ?? service.bot_metadata?.species)
  if (explicit) return explicit

  const text = appointmentServiceText(service)
  if (CAT_PATTERN.test(text)) return 'cat'
  if (DOG_PATTERN.test(text)) return 'dog'

  // Compatibilidade com o catálogo comercial antigo: os serviços de porte
  // "Banho/Tosa Pet" eram cadastrados para cães mesmo sem escrever "cão".
  if (/\b(banho|tosa|tosagem|tosar)\w*/.test(text)
    && /\bpet\b/.test(text)
    && /\bporte\b/.test(text)) return 'dog'

  return null
}

export function serviceFitsPetSpecies(service = {}, petSpecies = null) {
  const normalizedPetSpecies = normalizeSpecies(petSpecies)
  if (!normalizedPetSpecies || normalizedPetSpecies === 'all') return true
  const target = serviceSpeciesTarget(service)
  return !target || target === 'all' || target === normalizedPetSpecies
}

export function serviceSpeciesLabel(service = {}, { genericLabel = 'Cães e gatos' } = {}) {
  const target = serviceSpeciesTarget(service)
  if (target === 'dog') return 'Somente cães'
  if (target === 'cat') return 'Somente gatos'
  return genericLabel
}

export function serviceWeightRange(service = {}) {
  const explicitMin = finiteWeight(
    service.min_weight_kg
    ?? service.minWeightKg
    ?? service.weight_min_kg
    ?? service.weightMinKg,
  )
  const explicitMax = finiteWeight(
    service.max_weight_kg
    ?? service.maxWeightKg
    ?? service.weight_max_kg
    ?? service.weightMaxKg,
  )

  if (explicitMin !== null || explicitMax !== null) {
    return {
      min: explicitMin,
      max: explicitMax,
      minExclusive: false,
      source: 'configured',
    }
  }

  const text = appointmentServiceText(service)
  const parsedText = parseWeightFromText(text)
  if (parsedText) return parsedText

  // Fallback para catálogos antigos que codificam o porte apenas no nome.
  // A faixa explícita configurada na aba Serviços sempre tem prioridade.
  if (/\bporte\s*(?:mini|micro)|\b(?:mini|micro)\s*porte\b/.test(text)) {
    return { min: null, max: 5, minExclusive: false, source: 'name' }
  }
  if (/\bporte\s*pequen|\bpequen\w*\s*porte\b/.test(text)) {
    return { min: null, max: 9.99, minExclusive: false, source: 'name' }
  }
  if (/\bporte\s*medi|\bmedi\w*\s*porte\b/.test(text)) {
    return { min: 10, max: 19.99, minExclusive: false, source: 'name' }
  }
  if (/\bporte\s*grande|\bgrande\s*porte\b/.test(text)) {
    return { min: 20, max: 39.99, minExclusive: false, source: 'name' }
  }
  if (/\bporte\s*(?:gigante|extra\s*grande)|\b(?:gigante|extra\s*grande)\s*porte\b/.test(text)) {
    return { min: 40, max: null, minExclusive: false, source: 'name' }
  }

  return null
}

export function serviceFitsPetWeight(service = {}, weightKg = null) {
  const weight = finiteWeight(weightKg)
  if (weight === null) return true
  const range = serviceWeightRange(service)
  if (!range) return true

  if (range.min !== null) {
    if (range.minExclusive ? weight <= range.min : weight < range.min) return false
  }
  if (range.max !== null && weight > range.max) return false
  return true
}

export function serviceWeightRangeLabel(service = {}, { genericLabel = 'Todos os pesos' } = {}) {
  const range = serviceWeightRange(service)
  if (!range) return genericLabel

  const fmt = (value) => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  if (range.min !== null && range.max !== null) {
    return range.minExclusive
      ? `mais de ${fmt(range.min)} até ${fmt(range.max)} kg`
      : `${fmt(range.min)} a ${fmt(range.max)} kg`
  }
  if (range.max !== null) return `até ${fmt(range.max)} kg`
  if (range.min !== null) return `${range.minExclusive ? 'mais de' : 'a partir de'} ${fmt(range.min)} kg`
  return genericLabel
}

export function appointmentServiceKind(service = {}) {
  const text = appointmentServiceText(service)
  const declared = stripAccents(service.group_type || service.groupType || service.service_group || '')
  const hasTosa = TOSA_PATTERN.test(text)
  const hasBath = BATH_PATTERN.test(text)

  if (VETERINARY_PATTERN.test(text)) return 'veterinaria'
  if (hasBath && hasTosa) return 'banho_tosa'
  if (hasTosa) return 'tosa'
  if (hasBath) return 'banho'
  if (GROOMING_COMPLEMENT_PATTERN.test(text)) return 'complemento'
  if (declared === 'veterinaria') return 'veterinaria'
  if (declared === 'banho_tosa') return 'complemento'
  return 'outro'
}

export function classifyAppointmentServiceGroup(service = {}) {
  // A área escolhida no cadastro é a fonte de verdade. Inferência textual só
  // recupera cadastros antigos que ainda estão como "outro" ou sem grupo.
  const declared = stripAccents(service.group_type || service.groupType || service.service_group || '')
  if (VALID_APPOINTMENT_GROUPS.has(declared)) return declared

  const kind = appointmentServiceKind(service)
  if (kind === 'veterinaria') return 'veterinaria'
  if (['banho', 'tosa', 'banho_tosa', 'complemento'].includes(kind)) return 'banho_tosa'
  return 'outro'
}

export function serviceFitsAppointmentGroup(service, group) {
  if (!service || service.active === false) return false
  if (!VALID_APPOINTMENT_GROUPS.has(group)) return false
  return classifyAppointmentServiceGroup(service) === group
}

export function serviceOptionsForAppointmentGroup(services = [], group = 'banho_tosa') {
  return (services || []).filter((service) => serviceFitsAppointmentGroup(service, group))
}

export function appointmentServiceCodes(appointment = {}) {
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const codes = items
    .map((item) => String(item?.code || item?.service_type || '').trim())
    .filter(Boolean)

  if (codes.length > 0) return [...new Set(codes)]
  return appointment.service_type ? [String(appointment.service_type)] : []
}

export function calculateAppointmentServiceTotals(serviceCodes = [], services = []) {
  const byCode = new Map((services || []).map((service) => [String(service.value || service.code), service]))
  const selected = [...new Set((serviceCodes || []).filter(Boolean))]
    .map((code) => byCode.get(String(code)))
    .filter(Boolean)

  return {
    services: selected,
    price: selected.reduce((sum, service) => sum + Number(service.price ?? service.default_price ?? 0), 0),
    duration: selected.reduce((sum, service) => sum + Math.max(15, Number(service.duration ?? service.default_duration_min ?? 60)), 0),
  }
}

export function appointmentServiceLabel(appointment = {}, services = []) {
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const itemNames = items.map((item) => String(item?.name || '').trim()).filter(Boolean)
  if (itemNames.length > 0) return itemNames.join(' + ')

  const codes = appointmentServiceCodes(appointment)
  const byCode = new Map((services || []).map((service) => [String(service.value || service.code), service]))
  const names = codes
    .map((code) => byCode.get(String(code))?.label || byCode.get(String(code))?.name || code)
    .filter(Boolean)
  return names.join(' + ') || 'Servico'
}

export function appointmentServiceGroup(appointment = {}, services = []) {
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  const code = appointment?.service_type || appointment
  const catalogService = (services || []).find((item) => String(item.value || item.code) === String(code))

  const inferred = classifyAppointmentServiceGroup(catalogService || {
    code,
    name: items.map((item) => item?.name || item?.label || item?.service_name).filter(Boolean).join(' '),
    group_type: appointment?.service_group,
  })
  if (VALID_APPOINTMENT_GROUPS.has(inferred)) return inferred

  const itemGroup = items
    .map((item) => classifyAppointmentServiceGroup(item))
    .find((group) => VALID_APPOINTMENT_GROUPS.has(group))
  if (itemGroup) return itemGroup
  if (VALID_APPOINTMENT_GROUPS.has(appointment?.service_group)) return appointment.service_group
  return 'outro'
}
