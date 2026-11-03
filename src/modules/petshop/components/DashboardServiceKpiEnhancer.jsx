import { useEffect } from 'react'

import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { supabase } from '../../../lib/supabase'
import { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'

const normalize = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()

const CANCELLED_STATUSES = new Set(['cancelado', 'cancelled', 'no_show'])
const MONTHS = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

function serviceText(appointment, serviceMap) {
  const values = [appointment?.service_type]
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  items.forEach((item) => {
    values.push(item?.name, item?.label, item?.code, item?.service_code, item?.service_type)
  })

  return normalize(values
    .filter(Boolean)
    .flatMap((value) => [value, serviceMap.get(String(value))])
    .filter(Boolean)
    .join(' '))
}

function countServices(appointments, serviceMap) {
  return (appointments || []).reduce((totals, appointment) => {
    if (CANCELLED_STATUSES.has(normalize(appointment?.status))) return totals
    const text = serviceText(appointment, serviceMap)
    if (/\bbanho\b|\bbath\b/.test(text)) totals.baths += 1
    if (/\btosa\b|tesoura|maquina|groom|trim/.test(text)) totals.grooming += 1
    return totals
  }, { baths: 0, grooming: 0 })
}

function dashboardCardByLabel(label, marker) {
  return document.querySelector(`button.kpi-card[data-yuisync-service-kpi='${marker}']`)
    || [...document.querySelectorAll('button.kpi-card')].find((card) => {
      const labelNode = card.querySelector('p.text-xs, p[class*="uppercase"]')
      return normalize(labelNode?.textContent) === normalize(label)
    })
    || null
}

function agendaCardByLabel(label, marker) {
  return document.querySelector(`[data-yuisync-agenda-service-kpi='${marker}']`)
    || [...document.querySelectorAll('.page p')]
      .find((node) => normalize(node.textContent) === normalize(label))
      ?.closest('div.bg-card')
    || null
}

function updateDashboardCard(card, { label, value, sub, marker }) {
  if (!card) return
  const paragraphs = [...card.querySelectorAll('p')]
  const labelNode = paragraphs.find((node) => normalize(node.textContent) === 'confirmados'
    || normalize(node.textContent) === 'em andamento'
    || node.className.includes('uppercase'))
  const valueNode = paragraphs.find((node) => node.className.includes('text-3xl'))
  const subNode = paragraphs.find((node) => node !== labelNode && node !== valueNode && node.className.includes('text-xs'))

  if (labelNode) labelNode.textContent = label
  if (valueNode) valueNode.textContent = String(value)
  if (subNode) subNode.textContent = sub
  card.setAttribute('aria-label', `${label}: ${value}`)
  card.dataset.yuisyncServiceKpi = marker
}

function updateAgendaCard(card, { label, value, marker }) {
  if (!card) return
  const paragraphs = [...card.querySelectorAll('p')]
  const labelNode = paragraphs.find((node) => ['confirmados', 'em andamento', 'banhos', 'tosas'].includes(normalize(node.textContent)))
  const valueNode = paragraphs.find((node) => node.className.includes('font-display') && node.className.includes('text-2xl'))

  if (labelNode) labelNode.textContent = label
  if (valueNode) valueNode.textContent = String(value)
  card.dataset.yuisyncAgendaServiceKpi = marker
}

function applyServiceKpis(counts) {
  if (window.location.pathname.endsWith('/dashboard')) {
    updateDashboardCard(dashboardCardByLabel('Confirmados', 'banhos'), {
      label: 'Banhos',
      value: counts.baths,
      marker: 'banhos',
      sub: `${counts.baths} agendamento${counts.baths === 1 ? '' : 's'} de banho hoje`,
    })
    updateDashboardCard(dashboardCardByLabel('Em andamento', 'tosas'), {
      label: 'Tosas',
      value: counts.grooming,
      marker: 'tosas',
      sub: `${counts.grooming} agendamento${counts.grooming === 1 ? '' : 's'} de tosa hoje`,
    })
    return
  }

  if (window.location.pathname.endsWith('/agenda')) {
    updateAgendaCard(agendaCardByLabel('Confirmados', 'banhos'), {
      label: 'Banhos',
      value: counts.baths,
      marker: 'banhos',
    })
    updateAgendaCard(agendaCardByLabel('Em andamento', 'tosas'), {
      label: 'Tosas',
      value: counts.grooming,
      marker: 'tosas',
    })
  }
}

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function selectedAgendaDateKey() {
  const subtitle = [...document.querySelectorAll('.page-sub')]
    .find((node) => /\bde\b/.test(normalize(node.textContent)))
  const match = normalize(subtitle?.textContent).match(/(\d{1,2}) de ([a-z]+) de (\d{4})/)
  if (!match) return todayKey()
  const month = MONTHS[match[2]]
  if (!month) return todayKey()
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`
}

function dateRange(dateKey) {
  const [year, month, day] = String(dateKey || todayKey()).split('-').map(Number)
  const start = new Date(year, month - 1, day, 0, 0, 0, 0)
  const end = new Date(year, month - 1, day, 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function loadServiceCounts(moduleId, tenantId, dateKey) {
  const range = dateRange(dateKey)
  const [appointmentsResponse, servicesResponse] = await Promise.all([
    runWithTenantFallback(tenantId, async (includeTenant) => {
      let query = supabase
        .from('appointments')
        .select('id,status,service_type,service_items,scheduled_at')
        .eq('module_id', moduleId)
        .gte('scheduled_at', range.start)
        .lte('scheduled_at', range.end)
      query = applyTenantFilter(query, tenantId, includeTenant)
      return query
    }),
    runWithTenantFallback(tenantId, async (includeTenant) => {
      let query = supabase
        .from('petshop_services')
        .select('id,code,name')
        .eq('module_id', moduleId)
      query = applyTenantFilter(query, tenantId, includeTenant)
      return query
    }),
  ])

  if (appointmentsResponse.error) throw appointmentsResponse.error
  if (servicesResponse.error) throw servicesResponse.error

  const serviceMap = new Map()
  ;(servicesResponse.data || []).forEach((service) => {
    if (service?.id) serviceMap.set(String(service.id), service.name || service.code || '')
    if (service?.code) serviceMap.set(String(service.code), service.name || service.code || '')
  })

  return countServices(appointmentsResponse.data || [], serviceMap)
}

export function DashboardServiceKpiEnhancer() {
  const { activeTenantId } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()

  useEffect(() => {
    if (!activeTenantId || activeModuleId !== 'petshop') return undefined

    let cancelled = false
    let counts = { baths: 0, grooming: 0 }
    let frame = 0
    let loadedDateKey = ''
    let loadingDateKey = ''

    const currentDateKey = () => window.location.pathname.endsWith('/agenda')
      ? selectedAgendaDateKey()
      : todayKey()

    const refresh = async (dateKey = currentDateKey()) => {
      if (!dateKey || loadingDateKey === dateKey) return
      loadingDateKey = dateKey
      try {
        const loaded = await loadServiceCounts(activeModuleId, activeTenantId, dateKey)
        if (cancelled) return
        counts = loaded
        loadedDateKey = dateKey
        schedule()
      } catch (error) {
        console.warn('Falha ao calcular banhos e tosas:', error?.message || error)
      } finally {
        if (loadingDateKey === dateKey) loadingDateKey = ''
      }
    }

    const apply = () => {
      frame = 0
      const dateKey = currentDateKey()
      if (dateKey !== loadedDateKey) void refresh(dateKey)
      applyServiceKpis(counts)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    void refresh()
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 120_000)

    return () => {
      cancelled = true
      observer.disconnect()
      window.clearInterval(interval)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [activeModuleId, activeTenantId])

  return null
}

export default DashboardServiceKpiEnhancer
