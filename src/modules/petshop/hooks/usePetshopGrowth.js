import { useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../../lib/tenant'
import { percentageChange, summarizeGrowthTimeline } from '../../../shared/lib/analyticsMetrics'

const CLIENT_MIN_SELECT = 'id,name,phone,details'

const toLocalISODate = (date = new Date()) => {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const emptyExecutiveRow = (refDate) => ({
  ref_date: refDate,
  total_revenue: 0,
  total_sales: 0,
  new_leads: 0,
  leads_won: 0,
  bookings_created: 0,
  bookings_scheduled: 0,
  no_show_count: 0,
  report_cards_sent: 0,
})

const normalizeExecutiveRow = (row = {}) => ({
  ...emptyExecutiveRow(row.ref_date),
  ...row,
  total_revenue: toNumber(row.total_revenue, 0),
  total_sales: toNumber(row.total_sales, 0),
  new_leads: toNumber(row.new_leads, 0),
  leads_won: toNumber(row.leads_won, 0),
  no_show_count: toNumber(row.no_show_count, 0),
  bookings_created: toNumber(row.bookings_created, 0),
  bookings_scheduled: toNumber(row.bookings_scheduled, 0),
  report_cards_sent: toNumber(row.report_cards_sent, 0),
})

function buildExecutiveComparison(rows = [], days = 14) {
  const today = new Date()
  const currentStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))
  const previousStart = new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate() - days)
  const currentStartIso = toLocalISODate(currentStart)
  const previousStartIso = toLocalISODate(previousStart)
  const normalized = rows.map(normalizeExecutiveRow)
  const currentByDate = new Map(
    normalized.filter((row) => row.ref_date >= currentStartIso).map((row) => [row.ref_date, row]),
  )
  const timeline = Array.from({ length: days }, (_, index) => {
    const date = new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate() + index)
    const dateKey = toLocalISODate(date)
    return currentByDate.get(dateKey) || emptyExecutiveRow(dateKey)
  })
  const previousTimeline = normalized.filter((row) => (
    row.ref_date >= previousStartIso && row.ref_date < currentStartIso
  ))
  const summary = summarizeGrowthTimeline(timeline)
  const previousSummary = summarizeGrowthTimeline(previousTimeline)

  return {
    timeline,
    summary,
    previousSummary,
    changes: {
      totalRevenue: percentageChange(summary.totalRevenue, previousSummary.totalRevenue),
      newLeads: percentageChange(summary.newLeads, previousSummary.newLeads),
      noShows: percentageChange(summary.noShows, previousSummary.noShows),
      reportCardsSent: percentageChange(summary.reportCardsSent, previousSummary.reportCardsSent),
    },
  }
}

const sanitizeSlug = (value = '') => (
  value
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
)

const isMissingClientIdColumnError = (error) => {
  const message = String(error?.message || error?.details || error?.hint || '').toLowerCase()
  return message.includes('client_id') && message.includes('does not exist')
}

const createPortalToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now()}${Math.random().toString(16).slice(2, 12)}`
}

const mapClient = (client) => ({
  id: client?.id || null,
  owner_name: client?.name || '',
  phone: client?.phone || '',
  pet_name: client?.details?.pet_name || '',
})

const enrichClientRelation = (row) => ({
  ...row,
  client: mapClient(row?.clients || {}),
})

function assertActiveTenant(tenantId, action = 'salvar') {
  if (!tenantId) throw new Error(`Selecione uma empresa ativa antes de ${action}.`)
}

export function usePetshopGrowth() {
  const { activeModuleId } = useModuleCtx()
  const { activeTenantId } = useAuthCtx()
  const moduleId = activeModuleId || 'petshop'
  const runScoped = useCallback((runner) => runWithTenantFallback(activeTenantId, runner), [activeTenantId])

  const loadBookingSettings = useCallback(async () => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_booking_settings')
        .select('*')
        .eq('module_id', moduleId)
        .maybeSingle()
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error

    if (response.data) return response.data

    const defaultSlug = sanitizeSlug(`agenda-${String(activeTenantId || moduleId).slice(0, 8)}`) || 'agenda-petshop'
    const created = await saveBookingSettings({
      enabled: true,
      public_slug: defaultSlug,
      allow_whatsapp_fallback: true,
      lead_expiration_hours: 6,
      intake_message: 'Compartilhe nome do tutor, pet e servico desejado para reservarmos seu horario.',
    })
    return created
  }, [activeTenantId, moduleId, runScoped])

  const saveBookingSettings = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'salvar a agenda online')
    const slug = sanitizeSlug(payload.public_slug || `agenda-${String(activeTenantId || moduleId).slice(0, 8)}`) || 'agenda-petshop'
    const row = {
      module_id: moduleId,
      enabled: payload.enabled !== false,
      public_slug: slug,
      allow_whatsapp_fallback: payload.allow_whatsapp_fallback !== false,
      lead_expiration_hours: Math.max(1, toNumber(payload.lead_expiration_hours, 6)),
      intake_message: (payload.intake_message || '').trim() || null,
      updated_at: new Date().toISOString(),
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      return supabase
        .from('petshop_growth_booking_settings')
        .upsert(scoped, { onConflict: includeTenant ? 'tenant_id,module_id' : 'module_id' })
        .select('*')
        .single()
    })
    if (response.error) throw response.error
    return response.data
  }, [activeTenantId, moduleId, runScoped])

  const loadBookingRequests = useCallback(async ({ status = '', limit = 60 } = {}) => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_booking_requests')
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .eq('module_id', moduleId)
        .order('created_at', { ascending: false })
        .limit(limit)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      if (status) query = query.eq('status', status)
      return query
    })
    if (response.error) throw response.error
    return (response.data || []).map(enrichClientRelation)
  }, [activeTenantId, moduleId, runScoped])

  const createBookingRequest = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'registrar a solicitacao')
    let configuredMotodogFee = 0
    if (payload.need_motodog === true || payload.transport_mode === 'pickup') {
      const settingsResponse = await runScoped(async (includeTenant) => {
        let query = supabase
          .from('settings')
          .select('pet_transport_fee,pet_transport_options')
          .eq('module_id', moduleId)
          .maybeSingle()
        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })
      if (settingsResponse.error) throw settingsResponse.error
      const options = Array.isArray(settingsResponse.data?.pet_transport_options)
        ? settingsResponse.data.pet_transport_options
        : []
      const pickupOption = options.find((option) => option?.id === 'somente_buscar' && option?.active !== false)
      configuredMotodogFee = toNumber(pickupOption?.fee ?? settingsResponse.data?.pet_transport_fee, 0)
    }
    const row = {
      module_id: moduleId,
      client_id: payload.client_id || null,
      channel: payload.channel || 'manual',
      customer_name: (payload.customer_name || '').trim(),
      pet_name: (payload.pet_name || '').trim() || null,
      phone: (payload.phone || '').trim() || null,
      service_interest: (payload.service_interest || '').trim() || null,
      preferred_date: payload.preferred_date || null,
      preferred_period: payload.preferred_period || null,
      transport_mode: payload.transport_mode || 'dropoff',
      need_motodog: payload.need_motodog === true || payload.transport_mode === 'pickup',
      motodog_fee: configuredMotodogFee,
      pickup_address: (payload.pickup_address || '').trim() || null,
      pickup_neighborhood: (payload.pickup_neighborhood || '').trim() || null,
      pickup_city: (payload.pickup_city || '').trim() || null,
      status: payload.status || 'pending',
      notes: (payload.notes || '').trim() || null,
    }

    if (!row.customer_name) {
      throw new Error('Informe o nome do tutor para registrar o agendamento online.')
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      return supabase
        .from('petshop_growth_booking_requests')
        .insert(scoped)
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const updateBookingRequest = useCallback(async (requestId, payload) => {
    assertActiveTenant(activeTenantId, 'alterar a solicitacao')
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_booking_requests')
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('module_id', moduleId)
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const loadLeads = useCallback(async ({ stage = '', limit = 80 } = {}) => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_leads')
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .eq('module_id', moduleId)
        .order('created_at', { ascending: false })
        .limit(limit)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      if (stage) query = query.eq('stage', stage)
      return query
    })
    if (response.error) throw response.error
    return (response.data || []).map(enrichClientRelation)
  }, [activeTenantId, moduleId, runScoped])

  const createLead = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'criar o lead')
    const row = {
      module_id: moduleId,
      client_id: payload.client_id || null,
      source: payload.source || 'manual',
      stage: payload.stage || 'new',
      priority: payload.priority || 'normal',
      owner_name: (payload.owner_name || '').trim(),
      pet_name: (payload.pet_name || '').trim() || null,
      phone: (payload.phone || '').trim() || null,
      interest: (payload.interest || '').trim() || null,
      notes: (payload.notes || '').trim() || null,
      next_followup_at: payload.next_followup_at || null,
      last_contact_at: payload.last_contact_at || null,
      converted_sale_id: payload.converted_sale_id || null,
    }

    if (!row.owner_name) {
      throw new Error('Informe o nome do contato para criar o lead.')
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      return supabase
        .from('petshop_growth_leads')
        .insert(scoped)
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const updateLead = useCallback(async (leadId, payload) => {
    assertActiveTenant(activeTenantId, 'alterar o lead')
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_leads')
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leadId)
        .eq('module_id', moduleId)
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const promoteRequestToLead = useCallback(async (request) => {
    const lead = await createLead({
      client_id: request.client_id || null,
      source: 'booking_abandon',
      stage: 'new',
      priority: 'high',
      owner_name: request.customer_name || request.client?.owner_name || 'Contato sem nome',
      pet_name: request.pet_name || request.client?.pet_name || null,
      phone: request.phone || request.client?.phone || null,
      interest: request.service_interest || 'Agendamento pendente',
      notes: `Lead criado automaticamente a partir da solicitacao ${request.id}`,
      next_followup_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })

    await updateBookingRequest(request.id, {
      status: 'contacted',
      lead_id: lead.id,
      notes: request.notes || 'Movido para esteira de lead por abandono.',
    })

    return lead
  }, [createLead, updateBookingRequest])

  const loadNoShowPolicy = useCallback(async () => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_no_show_policy')
        .select('*')
        .eq('module_id', moduleId)
        .maybeSingle()
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    if (response.data) return response.data

    const fallback = await saveNoShowPolicy({
      require_prepayment: false,
      prepayment_amount: 0,
      grace_minutes: 15,
      max_strikes: 2,
      auto_block_days: 30,
      reminder_minutes_before: 90,
    })
    return fallback
  }, [activeTenantId, moduleId, runScoped])

  const saveNoShowPolicy = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'salvar a politica de no-show')
    const row = {
      module_id: moduleId,
      require_prepayment: payload.require_prepayment === true,
      prepayment_amount: toNumber(payload.prepayment_amount, 0),
      grace_minutes: Math.max(0, toNumber(payload.grace_minutes, 15)),
      max_strikes: Math.max(1, toNumber(payload.max_strikes, 2)),
      auto_block_days: Math.max(0, toNumber(payload.auto_block_days, 30)),
      reminder_minutes_before: Math.max(15, toNumber(payload.reminder_minutes_before, 90)),
      updated_at: new Date().toISOString(),
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      return supabase
        .from('petshop_growth_no_show_policy')
        .upsert(scoped, { onConflict: includeTenant ? 'tenant_id,module_id' : 'module_id' })
        .select('*')
        .single()
    })
    if (response.error) throw response.error
    return response.data
  }, [activeTenantId, moduleId, runScoped])

  const loadNoShowEvents = useCallback(async ({ limit = 80 } = {}) => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_no_show_events')
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .eq('module_id', moduleId)
        .order('created_at', { ascending: false })
        .limit(limit)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    return (response.data || []).map(enrichClientRelation)
  }, [activeTenantId, moduleId, runScoped])

  const registerNoShowEvent = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'registrar o no-show')
    const row = {
      module_id: moduleId,
      appointment_id: payload.appointment_id || null,
      client_id: payload.client_id || null,
      event_type: payload.event_type || 'no_show',
      fee_amount: toNumber(payload.fee_amount, 0),
      notes: (payload.notes || '').trim() || null,
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      return supabase
        .from('petshop_growth_no_show_events')
        .insert(scoped)
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const loadReportCards = useCallback(async ({ limit = 60 } = {}) => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_report_cards')
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .eq('module_id', moduleId)
        .order('created_at', { ascending: false })
        .limit(limit)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    return (response.data || []).map(enrichClientRelation)
  }, [activeTenantId, moduleId, runScoped])

  const saveReportCard = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'salvar o report card')
    const row = {
      module_id: moduleId,
      appointment_id: payload.appointment_id || null,
      client_id: payload.client_id || null,
      pet_name: (payload.pet_name || '').trim() || null,
      summary: (payload.summary || '').trim(),
      care_tips: (payload.care_tips || '').trim() || null,
      recommended_services: payload.recommended_services || [],
      next_visit_date: payload.next_visit_date || null,
      delivery_channel: payload.delivery_channel || 'whatsapp',
      delivered: payload.delivered === true,
      updated_at: new Date().toISOString(),
    }

    if (!row.summary) {
      throw new Error('Descreva o relatorio do atendimento antes de salvar.')
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      let query = payload.id
        ? supabase
          .from('petshop_growth_report_cards')
          .update(scoped)
          .eq('id', payload.id)
          .eq('module_id', moduleId)
        : supabase.from('petshop_growth_report_cards').insert(scoped)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query.select(`*,clients(${CLIENT_MIN_SELECT})`).single()
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const loadPortalAccess = useCallback(async ({ limit = 80 } = {}) => {
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_portal_access')
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .eq('module_id', moduleId)
        .order('updated_at', { ascending: false })
        .limit(limit)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    return (response.data || []).map(enrichClientRelation)
  }, [activeTenantId, moduleId, runScoped])

  const upsertPortalAccess = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'gerar acesso ao portal')
    if (!payload.client_id) {
      throw new Error('Selecione um cliente para gerar acesso ao portal.')
    }

    const row = {
      module_id: moduleId,
      client_id: payload.client_id,
      portal_token: payload.portal_token || createPortalToken(),
      status: payload.status || 'active',
      invited_at: payload.invited_at || new Date().toISOString(),
      expires_at: payload.expires_at || null,
      updated_at: new Date().toISOString(),
    }

    const response = await runScoped(async (includeTenant) => {
      const scoped = buildTenantPayload(row, activeTenantId, includeTenant)
      return supabase
        .from('petshop_growth_portal_access')
        .upsert(scoped, { onConflict: includeTenant ? 'tenant_id,module_id,client_id' : 'module_id,client_id' })
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const updatePortalAccess = useCallback(async (accessId, payload) => {
    assertActiveTenant(activeTenantId, 'alterar acesso ao portal')
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_portal_access')
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accessId)
        .eq('module_id', moduleId)
        .select(`*,clients(${CLIENT_MIN_SELECT})`)
        .single()

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    return enrichClientRelation(response.data)
  }, [activeTenantId, moduleId, runScoped])

  const buildPortalLink = useCallback((token) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/portal/${token}`
  }, [])

  const loadExecutiveTimelineFallback = useCallback(async ({ days = 14 } = {}) => {
    const daysSafe = Math.max(7, Math.min(90, Number(days || 14)))
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - ((daysSafe * 2) - 1))
    const startIso = toLocalISODate(startDate)

    const loadRows = async (table, dateColumn) => {
      const response = await runScoped(async (includeTenant) => {
        let query = supabase
          .from(table)
          .select('*')
          .eq('module_id', moduleId)
          .gte(dateColumn, `${startIso}T00:00:00`)
        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })
      if (response.error) throw response.error
      return response.data || []
    }

    const [sales, leads, bookings, noShows, reports] = await Promise.all([
      loadRows('sales', 'created_at'),
      loadRows('petshop_growth_leads', 'created_at'),
      loadRows('petshop_growth_booking_requests', 'created_at'),
      loadRows('petshop_growth_no_show_events', 'created_at'),
      loadRows('petshop_growth_report_cards', 'created_at'),
    ])

    const bucket = new Map()
    const ensureRow = (dateKey) => {
      if (!bucket.has(dateKey)) {
        bucket.set(dateKey, {
          ref_date: dateKey,
          total_revenue: 0,
          total_sales: 0,
          new_leads: 0,
          leads_won: 0,
          bookings_created: 0,
          bookings_scheduled: 0,
          no_show_count: 0,
          report_cards_sent: 0,
        })
      }
      return bucket.get(dateKey)
    }

    const toDateKey = (value) => {
      if (!value) return null
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return null
      return toLocalISODate(date)
    }

    sales.forEach((row) => {
      if (String(row.status || '') !== 'concluido') return
      const dateKey = toDateKey(row.created_at)
      if (!dateKey) return
      const entry = ensureRow(dateKey)
      entry.total_sales += 1
      entry.total_revenue += toNumber(row.total_price, 0)
    })

    leads.forEach((row) => {
      const dateKey = toDateKey(row.created_at)
      if (!dateKey) return
      const entry = ensureRow(dateKey)
      entry.new_leads += 1
      if (row.stage === 'won') entry.leads_won += 1
    })

    bookings.forEach((row) => {
      const dateKey = toDateKey(row.created_at)
      if (!dateKey) return
      const entry = ensureRow(dateKey)
      entry.bookings_created += 1
      if (row.status === 'scheduled') entry.bookings_scheduled += 1
    })

    noShows.forEach((row) => {
      const dateKey = toDateKey(row.created_at)
      if (!dateKey) return
      if (!['no_show', 'late_cancel'].includes(row.event_type)) return
      const entry = ensureRow(dateKey)
      entry.no_show_count += 1
    })

    reports.forEach((row) => {
      const dateKey = toDateKey(row.created_at)
      if (!dateKey) return
      if (row.delivered !== true) return
      const entry = ensureRow(dateKey)
      entry.report_cards_sent += 1
    })

    const timeline = Array.from(bucket.values())
      .sort((a, b) => String(a.ref_date).localeCompare(String(b.ref_date)))
      .map((row) => ({
        ...row,
        total_revenue: Number(row.total_revenue.toFixed(2)),
      }))

    return buildExecutiveComparison(timeline, daysSafe)
  }, [activeTenantId, moduleId, runScoped])

  const loadExecutiveTimeline = useCallback(async ({ days = 14 } = {}) => {
    const daysSafe = Math.max(7, Math.min(90, Number(days || 14)))
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - ((daysSafe * 2) - 1))

    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('petshop_growth_exec_daily')
        .select('*')
        .eq('module_id', moduleId)
        .gte('ref_date', toLocalISODate(startDate))
        .order('ref_date', { ascending: true })
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    if (response.error) {
      if (isMissingClientIdColumnError(response.error)) {
        return loadExecutiveTimelineFallback({ days: daysSafe })
      }
      throw response.error
    }

    return buildExecutiveComparison(response.data || [], daysSafe)
  }, [activeTenantId, loadExecutiveTimelineFallback, moduleId, runScoped])

  return {
    loadBookingSettings,
    saveBookingSettings,
    loadBookingRequests,
    createBookingRequest,
    updateBookingRequest,
    loadLeads,
    createLead,
    updateLead,
    promoteRequestToLead,
    loadNoShowPolicy,
    saveNoShowPolicy,
    loadNoShowEvents,
    registerNoShowEvent,
    loadReportCards,
    saveReportCard,
    loadPortalAccess,
    upsertPortalAccess,
    updatePortalAccess,
    buildPortalLink,
    loadExecutiveTimeline,
  }
}
