const number = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function percentageChange(currentValue, previousValue) {
  const current = number(currentValue)
  const previous = number(previousValue)
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function summarizeSales(rows = []) {
  const sales = Array.isArray(rows) ? rows : []
  const revenue = sales.reduce((total, sale) => total + number(sale?.total_price), 0)
  const discount = sales.reduce((total, sale) => total + number(sale?.discount), 0)
  const customerIds = new Set(
    sales.map((sale) => String(sale?.client_id || '').trim()).filter(Boolean),
  )

  return {
    revenue,
    discount,
    count: sales.length,
    avgTicket: sales.length ? revenue / sales.length : 0,
    customerCount: customerIds.size,
  }
}

export function compareSalesPeriods(currentRows = [], previousRows = []) {
  const current = summarizeSales(currentRows)
  const previous = summarizeSales(previousRows)
  return {
    current,
    previous,
    changes: {
      revenue: percentageChange(current.revenue, previous.revenue),
      avgTicket: percentageChange(current.avgTicket, previous.avgTicket),
      count: percentageChange(current.count, previous.count),
      customerCount: percentageChange(current.customerCount, previous.customerCount),
    },
  }
}

export function tutorIdentity(client = {}) {
  const groupId = String(client?.details?.tutor_group_id || '').trim()
  return groupId || String(client?.id || '').trim()
}

export function groupClientsByTutor(clients = []) {
  const groups = new Map()
  for (const client of Array.isArray(clients) ? clients : []) {
    const tutorId = tutorIdentity(client)
    if (!tutorId) continue
    const current = groups.get(tutorId) || {
      id: tutorId,
      owner_name: client?.name || '',
      phone: client?.phone || '',
      pets: [],
      identityIds: new Set([tutorId]),
    }
    if (client?.id) current.identityIds.add(String(client.id))
    if (client?.details?.pet_name) current.pets.push(client.details.pet_name)
    if (!current.owner_name && client?.name) current.owner_name = client.name
    if (!current.phone && client?.phone) current.phone = client.phone
    groups.set(tutorId, current)
  }
  return [...groups.values()]
}

export function buildCustomerInsights(clients = [], sales = [], threshold = new Date()) {
  const latestSaleByIdentity = new Map()
  for (const sale of Array.isArray(sales) ? sales : []) {
    const clientId = String(sale?.client_id || '').trim()
    const createdAt = sale?.created_at
    if (!clientId || !createdAt) continue
    const current = latestSaleByIdentity.get(clientId)
    if (!current || new Date(createdAt).getTime() > new Date(current).getTime()) {
      latestSaleByIdentity.set(clientId, createdAt)
    }
  }

  const thresholdTime = new Date(threshold).getTime()
  const tutors = groupClientsByTutor(clients)
  const atRisk = tutors.flatMap((tutor) => {
    const lastSeen = [...tutor.identityIds]
      .map((identity) => latestSaleByIdentity.get(identity))
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null

    if (lastSeen && new Date(lastSeen).getTime() >= thresholdTime) return []
    return [{
      id: tutor.id,
      pet_name: tutor.pets.join(', '),
      owner_name: tutor.owner_name,
      phone: tutor.phone,
      lastSeen: lastSeen || 'Nunca',
    }]
  })

  atRisk.sort((left, right) => {
    if (left.lastSeen === 'Nunca' && right.lastSeen !== 'Nunca') return -1
    if (right.lastSeen === 'Nunca' && left.lastSeen !== 'Nunca') return 1
    return new Date(left.lastSeen).getTime() - new Date(right.lastSeen).getTime()
  })

  return { activeCount: tutors.length, atRisk }
}

export function summarizeChatResolution(sessions = [], messages = []) {
  const humanHandled = new Set()
  const assistantHandled = new Set()
  const blockedReasons = {}

  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role === 'human_agent') humanHandled.add(message.session_id)
    if (message?.role === 'assistant') assistantHandled.add(message.session_id)
    const reasons = message?.metadata?.petbot_guard?.blocked_reasons
    if (!Array.isArray(reasons)) continue
    reasons.forEach((reason) => {
      const key = String(reason || '').trim()
      if (key) blockedReasons[key] = (blockedReasons[key] || 0) + 1
    })
  }

  const rows = Array.isArray(sessions) ? sessions : []
  const closedSessions = rows.filter((session) => (
    session?.status === 'closed' || session?.csat_score != null || session?.closed_at
  ))
  const ratings = rows
    .filter((session) => session?.csat_score != null && session?.csat_score !== '')
    .map((session) => Number(session.csat_score))
    .filter((score) => Number.isFinite(score) && score >= 1 && score <= 5)
  const aiResolved = closedSessions.filter((session) => (
    assistantHandled.has(session.id) && !humanHandled.has(session.id)
  )).length
  const humanResolved = closedSessions.filter((session) => humanHandled.has(session.id)).length

  return {
    avgCsat: ratings.length ? ratings.reduce((sum, score) => sum + score, 0) / ratings.length : null,
    csatCount: ratings.length,
    aiResolved,
    humanResolved,
    unclassifiedResolved: Math.max(0, closedSessions.length - aiResolved - humanResolved),
    closedCount: closedSessions.length,
    blockedReasons,
  }
}

export const EMPTY_GROWTH_SUMMARY = Object.freeze({
  totalRevenue: 0,
  totalSales: 0,
  newLeads: 0,
  wonLeads: 0,
  noShows: 0,
  bookings: 0,
  bookingsScheduled: 0,
  reportCardsSent: 0,
})

export function summarizeGrowthTimeline(timeline = []) {
  return (Array.isArray(timeline) ? timeline : []).reduce((summary, row) => ({
    totalRevenue: summary.totalRevenue + number(row?.total_revenue),
    totalSales: summary.totalSales + number(row?.total_sales),
    newLeads: summary.newLeads + number(row?.new_leads),
    wonLeads: summary.wonLeads + number(row?.leads_won),
    noShows: summary.noShows + number(row?.no_show_count),
    bookings: summary.bookings + number(row?.bookings_created),
    bookingsScheduled: summary.bookingsScheduled + number(row?.bookings_scheduled),
    reportCardsSent: summary.reportCardsSent + number(row?.report_cards_sent),
  }), { ...EMPTY_GROWTH_SUMMARY })
}

