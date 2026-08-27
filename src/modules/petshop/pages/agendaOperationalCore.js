export const DEFAULT_TRANSPORT_OPTIONS = [
  { id: 'buscar_e_levar', label: 'Buscar e levar', fee: 20, active: true },
  { id: 'buscar_e_levar_fora_muriae', label: 'Buscar e levar (fora de Muriaé)', fee: 30, active: true },
  { id: 'somente_buscar', label: 'Somente buscar', fee: 15, active: true },
  { id: 'somente_levar', label: 'Somente levar', fee: 15, active: true },
]

export const normalizeText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

export const moneyNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localDateKey(value) {
  const parsed = new Date(value || '')
  return Number.isNaN(parsed.getTime()) ? '' : isoDate(parsed)
}

const MONTHS_PT = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
}

export function parseAgendaDate(text) {
  const normalized = normalizeText(text)
  const longMatch = normalized.match(/(\d{1,2}) de ([a-z]+) de (\d{4})/)
  if (longMatch) {
    const month = MONTHS_PT[longMatch[2]]
    if (month !== undefined) {
      const parsed = new Date(Number(longMatch[3]), month, Number(longMatch[1]), 12, 0, 0, 0)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }

  const shortMatch = normalized.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (!shortMatch) return null
  const currentYear = new Date().getFullYear()
  const rawYear = shortMatch[3] ? Number(shortMatch[3]) : currentYear
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  const parsed = new Date(year, Number(shortMatch[2]) - 1, Number(shortMatch[1]), 12, 0, 0, 0)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function appointmentInterval(appointment) {
  const start = new Date(appointment?.scheduled_at || '')
  if (Number.isNaN(start.getTime())) return 'Horario nao informado'
  const duration = Math.max(10, Number(appointment?.duration_min || 60))
  const end = new Date(start.getTime() + duration * 60 * 1000)
  const format = (value) => value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${format(start)} - ${format(end)}`
}

export function normalizeTransportOptions(storeSettings = {}) {
  const configured = Array.isArray(storeSettings?.pet_transport_options)
    ? storeSettings.pet_transport_options
    : []
  const defaultIds = new Set(DEFAULT_TRANSPORT_OPTIONS.map((option) => option.id))
  const configuredById = new Map(configured.map((option) => [String(option?.id || ''), option]))
  const source = [
    ...DEFAULT_TRANSPORT_OPTIONS.map((option) => ({ ...option, ...(configuredById.get(option.id) || {}) })),
    ...configured.filter((option) => !defaultIds.has(String(option?.id || ''))),
  ]
  return source.map((option, index) => ({
    id: String(option?.id || DEFAULT_TRANSPORT_OPTIONS[index]?.id || ''),
    label: String(option?.label || DEFAULT_TRANSPORT_OPTIONS[index]?.label || 'Transporte'),
    fee: Math.max(0, moneyNumber(option?.fee ?? DEFAULT_TRANSPORT_OPTIONS[index]?.fee ?? 0)),
    active: option?.active !== false,
  }))
}

export function transportFeeForMode(options, mode) {
  if (!mode || mode === 'cliente_leva') return 0
  return options.find((option) => option.id === mode && option.active)?.fee || 0
}

export function servicePriceFromItems(appointment) {
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  return items.reduce((sum, item) => (
    sum + Math.max(0, moneyNumber(item?.unit_price ?? item?.price ?? item?.default_price ?? item?.amount ?? 0))
  ), 0)
}

export function appointmentPriceBreakdown(appointment, transportOptions) {
  const transportMode = appointment?.transport_mode || appointment?.motodog?.mode || 'cliente_leva'
  const catalogTransport = transportFeeForMode(transportOptions, transportMode)
  const stored = Math.max(0, moneyNumber(appointment?.price))
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  const itemService = servicePriceFromItems(appointment)
  const transportCovered = items.some((item) => item?.transport_benefit_used === true)

  // O snapshot explicita quando o MotoDog foi abatido. Sem essa marca, preserva
  // a reconciliacao legada: servico armazenado + tarifa configurada.
  if (items.length > 0) {
    const transport = transportCovered ? 0 : catalogTransport
    return {
      service: itemService,
      transport,
      total: Math.max(stored, itemService + transport),
    }
  }

  // Compatibilidade com agendamentos antigos que nao possuem service_items.
  if (catalogTransport > 0 && stored >= catalogTransport) {
    return {
      service: Math.max(0, stored - catalogTransport),
      transport: catalogTransport,
      total: stored,
    }
  }

  return { service: stored, transport: 0, total: stored }
}

export function slotTimeFromAria(slot) {
  return slot?.getAttribute?.('aria-label')?.match(/(\d{2}:\d{2})/)?.[1] || ''
}

export function chooseAgendaSlot(slots, clientX, clientY) {
  const candidates = Array.from(slots || [])
    .map((slot) => ({ slot, rect: slot.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom >= 0 && rect.top <= window.innerHeight)

  const exact = candidates
    .filter(({ rect }) => (
    clientX >= rect.left && clientX <= rect.right
    && clientY >= rect.top && clientY <= rect.bottom
    ))
    .sort((left, right) => (
      Math.hypot(
        (left.rect.left + left.rect.right) / 2 - clientX,
        (left.rect.top + left.rect.bottom) / 2 - clientY,
      )
      - Math.hypot(
        (right.rect.left + right.rect.right) / 2 - clientX,
        (right.rect.top + right.rect.bottom) / 2 - clientY,
      )
    ))[0]
  if (exact) return exact.slot

  const horizontallyAligned = candidates.filter(({ rect }) => (
    clientX >= rect.left - 48 && clientX <= rect.right + 48
  ))
  const source = horizontallyAligned.length > 0 ? horizontallyAligned : candidates
  return source
    .sort((left, right) => (
      Math.abs((left.rect.top + left.rect.bottom) / 2 - clientY)
      - Math.abs((right.rect.top + right.rect.bottom) / 2 - clientY)
    ))[0]?.slot || null
}

export function findAgendaCardCandidate(candidates, {
  interval,
  petName,
  statusLabel,
}, usedCards = new Set()) {
  const normalizedInterval = normalizeText(interval)
  const normalizedPet = normalizeText(petName)
  const normalizedStatus = normalizeText(statusLabel)
  const available = Array.from(candidates || []).filter((candidate) => !usedCards.has(candidate))

  const exact = available.find((candidate) => {
    const text = normalizeText(candidate?.textContent)
    return text.includes(normalizedInterval)
      && text.includes(normalizedPet)
      && text.includes(normalizedStatus)
  })
  if (exact) return exact

  return available.find((candidate) => {
    const text = normalizeText(candidate?.textContent)
    return text.includes(normalizedInterval) && text.includes(normalizedPet)
  }) || null
}
