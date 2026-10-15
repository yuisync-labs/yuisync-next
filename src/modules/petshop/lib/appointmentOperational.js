const clean = (value = '') => String(value ?? '').trim()

const normalize = (value = '') => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

// Referencia visual maxima usada em textos e configuracoes legadas.
// A largura real dos cards e adaptativa e nao limita agendamentos.
export const MANUAL_SLOT_CAPACITY = 4

export function agendaVisualLaneCount(concurrent = 0) {
  const count = Math.max(0, Math.trunc(Number(concurrent) || 0))
  return Math.max(1, count)
}

const validTime = (value) => {
  const time = value instanceof Date ? value.getTime() : new Date(value || '').getTime()
  return Number.isFinite(time) ? time : null
}

export function layoutAgendaOverlapClusters(items = [], getBounds = (item) => item?.bounds) {
  const prepared = (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const bounds = getBounds(item)
      const startMs = validTime(bounds?.start)
      const endMs = validTime(bounds?.end)
      const createdMs = validTime(item?.created_at)
      if (startMs === null || endMs === null || endMs <= startMs) return null
      return { item, bounds, startMs, endMs, createdMs, index }
    })
    .filter(Boolean)
    .sort((left, right) => (
      (left.startMs - right.startMs)
      || ((left.createdMs ?? Number.POSITIVE_INFINITY) - (right.createdMs ?? Number.POSITIVE_INFINITY))
      || (left.index - right.index)
    ))

  const positioned = []
  let cluster = []
  let clusterEnd = Number.NEGATIVE_INFINITY

  const flushCluster = () => {
    if (!cluster.length) return
    const laneEnds = []
    const clusterPositions = cluster.map((entry) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= entry.startMs)
      if (lane < 0) {
        lane = laneEnds.length
        laneEnds.push(Number.NEGATIVE_INFINITY)
      }
      laneEnds[lane] = entry.endMs
      return { ...entry, lane }
    })
    const laneCount = agendaVisualLaneCount(laneEnds.length)
    clusterPositions.forEach((entry) => {
      let laneSpan = 1
      // Expand into free lanes only when they stay free for the whole card.
      for (let nextLane = entry.lane + 1; nextLane < laneCount; nextLane += 1) {
        const occupied = clusterPositions.some((other) => (
          other.lane === nextLane && other.startMs < entry.endMs && other.endMs > entry.startMs
        ))
        if (occupied) break
        laneSpan += 1
      }
      const { item, bounds, lane } = entry
      positioned.push({ item, bounds, lane, laneCount, laneSpan })
    })
    cluster = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  prepared.forEach((entry) => {
    if (cluster.length && entry.startMs >= clusterEnd) flushCluster()
    cluster.push(entry)
    clusterEnd = Math.max(clusterEnd, entry.endMs)
  })
  flushCluster()

  return positioned
}

const NON_BLOCKING_STATUSES = new Set(['cancelado', 'cancelled', 'no_show', 'concluido', 'completed', 'finalizado'])

export function appointmentOccupiesManualSlot(appointment = {}) {
  return !NON_BLOCKING_STATUSES.has(normalize(appointment?.status))
}

export function isMotodogTransportMode(mode = '') {
  return ['buscar_e_levar', 'buscar_e_levar_fora_muriae', 'somente_buscar', 'somente_levar', 'motodog'].includes(normalize(mode))
}

export function appointmentTransportLabel(mode = '') {
  const normalized = normalize(mode)
  if (normalized === 'cliente_leva') return 'Cliente traz e busca'
  if (normalized === 'buscar_e_levar') return 'MotoDog — buscar e levar'
  if (normalized === 'buscar_e_levar_fora_muriae') return 'MotoDog — buscar e levar (fora de Muriaé)'
  if (normalized === 'somente_buscar') return 'MotoDog — somente buscar'
  if (normalized === 'somente_levar') return 'MotoDog — somente levar'
  if (normalized === 'motodog') return 'MotoDog'
  return 'Não informado'
}

export function appointmentTransportAddress(appointment = {}) {
  const motodog = appointment?.motodog || {}
  return [
    motodog.address,
    motodog.neighborhood,
    motodog.city,
  ].map(clean).filter(Boolean).join(' - ')
}

export function operationalCommissionRate(service = {}) {
  const group = normalize(service?.group_type || service?.service_group)
  if (group && group !== 'banho_tosa') return 0

  const text = normalize([
    service?.code,
    service?.name,
    service?.label,
    service?.service_type,
  ].filter(Boolean).join(' '))

  if (!text) return 0
  if (/(?:tosa|tesoura|maquina|groom|trim)/.test(text)) return 10
  return 5
}
