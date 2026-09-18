import { useState, useCallback } from 'react'
import { supabase, getTimezoneOffset } from '../../lib/supabase'
import { useModuleCtx } from '../../context/ModuleContext'
import { useAuthCtx } from '../../context/AuthContext'
import { applyTenantFilter, runWithTenantFallback } from '../../lib/tenant'
import {
  buildCustomerInsights,
  compareSalesPeriods,
  summarizeChatResolution,
} from '../lib/analyticsMetrics'

const PAGE_SIZE = 1000

const startOfLocalDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1)

function localBoundary(date, timezoneOffset = getTimezoneOffset()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}T00:00:00${timezoneOffset}`
}

function sumSalesBetween(rows, start, end) {
  const startTime = start.getTime()
  const endTime = end.getTime()
  return rows.reduce((total, sale) => {
    const createdAt = new Date(sale?.created_at).getTime()
    if (!Number.isFinite(createdAt) || createdAt < startTime || createdAt >= endTime) return total
    return total + (Number(sale?.total_price) || 0)
  }, 0)
}

async function fetchAllPages(buildQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await buildQuery(from, from + PAGE_SIZE - 1)
    if (response.error) throw response.error
    const page = response.data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

export function useAnalytics() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { activeModuleId } = useModuleCtx()
  const { activeTenantId } = useAuthCtx()

  const loadSalesBetween = useCallback(async ({ start, end } = {}) => (
    fetchAllPages(async (from, to) => runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('sales')
        .select('client_id, total_price, discount, created_at')
        .eq('module_id', activeModuleId)
        .eq('status', 'concluido')
        .order('created_at', { ascending: true })
        .range(from, to)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      if (start) query = query.gte('created_at', start)
      if (end) query = query.lt('created_at', end)
      return query
    }))
  ), [activeModuleId, activeTenantId])

  const loadActiveClients = useCallback(async () => (
    fetchAllPages(async (from, to) => runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('clients')
        .select('id, name, phone, details, created_at')
        .eq('module_id', activeModuleId)
        .eq('active', true)
        .order('created_at', { ascending: true })
        .range(from, to)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    }))
  ), [activeModuleId, activeTenantId])

  const getOverviewMetrics = useCallback(async () => {
    if (!activeModuleId) return null
    setLoading(true)
    setError(null)

    try {
      const now = new Date()
      const timezoneOffset = getTimezoneOffset()
      const currentStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
      const currentEndDate = addDays(startOfLocalDay(now), 1)
      const previousStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const previousMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
      const comparableDay = Math.min(now.getDate(), previousMonthLastDay)
      const previousEndDate = new Date(now.getFullYear(), now.getMonth() - 1, comparableDay + 1)

      const [currentRows, previousRows] = await Promise.all([
        loadSalesBetween({
          start: localBoundary(currentStartDate, timezoneOffset),
          end: localBoundary(currentEndDate, timezoneOffset),
        }),
        loadSalesBetween({
          start: localBoundary(previousStartDate, timezoneOffset),
          end: localBoundary(previousEndDate, timezoneOffset),
        }),
      ])

      return {
        ...compareSalesPeriods(currentRows, previousRows),
        periodLabel: `1 a ${now.getDate()} deste mês`,
      }
    } catch (loadError) {
      setError(loadError.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [activeModuleId, loadSalesBetween])

  const getDynamicRevenueChart = useCallback(async (range = 'mensal') => {
    if (!activeModuleId) return []

    try {
      const now = startOfLocalDay(new Date())
      const timezoneOffset = getTimezoneOffset()
      let currentBuckets = []
      let previousBuckets = []

      if (range === 'diario') {
        const currentStart = addDays(now, -6)
        const previousStart = addDays(currentStart, -7)
        currentBuckets = Array.from({ length: 7 }, (_, index) => {
          const start = addDays(currentStart, index)
          return {
            name: start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase(),
            start,
            end: addDays(start, 1),
          }
        })
        previousBuckets = Array.from({ length: 7 }, (_, index) => {
          const start = addDays(previousStart, index)
          return { start, end: addDays(start, 1) }
        })
      } else if (range === 'semanal') {
        const currentStart = addDays(now, -27)
        const previousStart = addDays(currentStart, -28)
        currentBuckets = Array.from({ length: 4 }, (_, index) => {
          const start = addDays(currentStart, index * 7)
          return { name: `SEM ${index + 1}`, start, end: addDays(start, 7) }
        })
        previousBuckets = Array.from({ length: 4 }, (_, index) => {
          const start = addDays(previousStart, index * 7)
          return { start, end: addDays(start, 7) }
        })
      } else {
        const currentStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)
        const previousStart = addMonths(currentStart, -6)
        currentBuckets = Array.from({ length: 6 }, (_, index) => {
          const start = addMonths(currentStart, index)
          return {
            name: start.toLocaleString('pt-BR', { month: 'short' }).toUpperCase(),
            start,
            end: index === 5 ? addDays(now, 1) : addMonths(start, 1),
          }
        })
        previousBuckets = Array.from({ length: 6 }, (_, index) => {
          const start = addMonths(previousStart, index)
          return { start, end: addMonths(start, 1) }
        })
      }

      const rows = await loadSalesBetween({
        start: localBoundary(previousBuckets[0].start, timezoneOffset),
        end: localBoundary(currentBuckets[currentBuckets.length - 1].end, timezoneOffset),
      })

      return currentBuckets.map((bucket, index) => ({
        name: bucket.name,
        current: sumSalesBetween(rows, bucket.start, bucket.end),
        previous: sumSalesBetween(rows, previousBuckets[index].start, previousBuckets[index].end),
      }))
    } catch (loadError) {
      console.error(loadError)
      return []
    }
  }, [activeModuleId, loadSalesBetween])

  const getCustomerInsights = useCallback(async () => {
    if (!activeModuleId) return { activeCount: 0, atRisk: [] }
    try {
      const [clients, sales] = await Promise.all([
        loadActiveClients(),
        loadSalesBetween({}),
      ])
      const threshold = new Date()
      threshold.setDate(threshold.getDate() - 30)
      const insights = buildCustomerInsights(clients, sales, threshold)
      return { ...insights, atRisk: insights.atRisk.slice(0, 5) }
    } catch (loadError) {
      console.error(loadError)
      return { activeCount: 0, atRisk: [] }
    }
  }, [activeModuleId, loadActiveClients, loadSalesBetween])

  const getAtRiskCustomers = useCallback(async () => (
    (await getCustomerInsights()).atRisk
  ), [getCustomerInsights])

  const getCustomerCount = useCallback(async () => (
    (await getCustomerInsights()).activeCount
  ), [getCustomerInsights])

  const getChatResolutionMetrics = useCallback(async () => {
    const empty = summarizeChatResolution([], [])
    if (!activeModuleId) return empty

    try {
      const sessionsResponse = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('chat_sessions')
          .select('id, status, csat_score, created_at, closed_at')
          .eq('module_id', activeModuleId)
          .order('last_message_at', { ascending: false })
          .limit(500)

        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })

      if (sessionsResponse.error) throw sessionsResponse.error
      const sessions = sessionsResponse.data || []
      const sessionIds = sessions.map((session) => session.id)
      if (sessionIds.length === 0) return empty

      const messagesResponse = await supabase
        .from('chat_messages')
        .select('session_id, role, metadata')
        .in('session_id', sessionIds)

      if (messagesResponse.error) throw messagesResponse.error
      return summarizeChatResolution(sessions, messagesResponse.data || [])
    } catch (loadError) {
      console.error(loadError)
      return empty
    }
  }, [activeModuleId, activeTenantId])

  return {
    loading,
    error,
    getOverviewMetrics,
    getDynamicRevenueChart,
    getCustomerInsights,
    getAtRiskCustomers,
    getCustomerCount,
    getChatResolutionMetrics,
  }
}
