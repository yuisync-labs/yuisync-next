import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase, todayISO, getTimezoneOffset } from '../../lib/supabase'
import { useModuleCtx } from '../../context/ModuleContext'
import { useAuthCtx } from '../../context/AuthContext'
import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../lib/tenant'

const APPOINTMENT_BASE_FIELDS = `
  id, pet_id, client_id, service_type, service_group, service_items, scheduled_at, duration_min, price, status, notes, source, created_at,
  employee_id, groomer_id, responsible_staff_key, responsible_staff_name,
  delivery_staff_key, delivery_staff_name,
  transport_mode, transport_label, transport_address, transport_neighborhood, transport_city, transport_reference,
  live_status, checkin_at, ready_at, subscription_id, subscription_benefit_used
`
const APPOINTMENT_SELECT = `${APPOINTMENT_BASE_FIELDS},
  clients ( id, name, document, phone, email, address, neighborhood, city, notes, details )
`
const SERVICE_TRANSPORT_SELECT = `
  id, client_id, sale_id, scheduled_for, delivery_address, delivery_neighborhood,
  delivery_city, delivery_reference, transport_mode, transport_label
`

const APPOINTMENT_SYNC_EVENT = 'yuisync:appointments-sync'

function sortAppointmentState(items = []) {
  return [...items].sort((left, right) => new Date(left?.scheduled_at || 0) - new Date(right?.scheduled_at || 0))
}

function mergeAppointmentState(items = [], appointment) {
  if (!appointment?.id) return items
  const exists = items.some((item) => String(item?.id) === String(appointment.id))
  return sortAppointmentState(exists
    ? items.map((item) => String(item?.id) === String(appointment.id) ? appointment : item)
    : [...items, appointment])
}

function emitAppointmentSync(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(APPOINTMENT_SYNC_EVENT, { detail }))
}

function transportScheduleKey(clientId, value) {
  if (!clientId || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCSeconds(0, 0)
  return `${clientId}|${date.toISOString()}`
}

async function loadAppointmentTransportMap(moduleId, tenantId, appointments = []) {
  if (moduleId !== 'petshop' || !tenantId || !appointments.length) return new Map()
  const scheduledValues = appointments
    .map((appointment) => new Date(appointment?.scheduled_at || '').getTime())
    .filter(Number.isFinite)
  if (!scheduledValues.length) return new Map()

  const minScheduled = new Date(Math.min(...scheduledValues) - 60 * 1000).toISOString()
  const maxScheduled = new Date(Math.max(...scheduledValues) + 60 * 1000).toISOString()
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('service_delivery_orders')
      .select(SERVICE_TRANSPORT_SELECT)
      .eq('module_id', moduleId)
      .eq('order_type', 'servico')
      .not('transport_mode', 'is', null)
      .gte('scheduled_for', minScheduled)
      .lte('scheduled_for', maxScheduled)

    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })

  if (response.error) {
    console.warn('Falha ao carregar dados do MotoDog para a agenda:', response.error.message)
    return new Map()
  }

  return new Map((response.data || [])
    .map((order) => [transportScheduleKey(order.client_id, order.scheduled_for), order])
    .filter(([key]) => key))
}

async function enrichAppointmentsWithTransport(moduleId, tenantId, appointments = []) {
  const transportMap = await loadAppointmentTransportMap(moduleId, tenantId, appointments)
  if (!transportMap.size) return appointments
  return appointments.map((appointment) => {
    const transport = transportMap.get(transportScheduleKey(appointment.client_id, appointment.scheduled_at))
    if (!transport) return appointment
    return {
      ...appointment,
      motodog: {
        ...(appointment.motodog || {}),
        mode: transport.transport_mode || appointment.motodog?.mode || null,
        label: transport.transport_label || appointment.motodog?.label || null,
        address: transport.delivery_address || appointment.motodog?.address || null,
        neighborhood: transport.delivery_neighborhood || appointment.motodog?.neighborhood || null,
        city: transport.delivery_city || appointment.motodog?.city || null,
        reference: transport.delivery_reference || appointment.motodog?.reference || null,
      },
    }
  })
}

function isClientRelationError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false
  return message.includes('appointments') && message.includes('clients') && (
    message.includes('schema cache')
    || message.includes('relationship')
    || message.includes('could not find')
  )
}

function mapAppointmentRow(appointment) {
  if (!appointment) return appointment
  const normalized = {
    ...appointment,
    service_items: Array.isArray(appointment.service_items) ? appointment.service_items : [],
    motodog: appointment.transport_mode
      ? {
        mode: appointment.transport_mode,
        label: appointment.transport_label || null,
        address: appointment.transport_address || null,
        neighborhood: appointment.transport_neighborhood || null,
        city: appointment.transport_city || null,
        reference: appointment.transport_reference || null,
        staff_key: appointment.delivery_staff_key || null,
        staff_name: appointment.delivery_staff_name || null,
      }
      : null,
  }
  if (!normalized.clients) return normalized
  return {
    ...normalized,
    pets: {
      id: normalized.clients.id,
      owner_name: normalized.clients.name,
      phone: normalized.clients.phone,
      email: normalized.clients.email,
      owner_address: normalized.clients.address,
      owner_neighborhood: normalized.clients.neighborhood,
      owner_city: normalized.clients.city,
      zip_code: normalized.clients.details?.zip_code || '',
      address_number: normalized.clients.details?.address_number || '',
      address_complement: normalized.clients.details?.address_complement || '',
      address_reference: normalized.clients.details?.address_reference || '',
      pet_name: normalized.clients.details?.pet_name || '',
      species: normalized.clients.details?.species || '',
      breed: normalized.clients.details?.breed || '',
      weight_kg: normalized.clients.details?.weight_kg || null,
      notes: normalized.clients.details?.pet_notes || normalized.clients.notes || '',
    },
    clients: undefined,
  }
}

async function loadClientsMap(activeModuleId, activeTenantId, clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))]
  if (ids.length === 0) return new Map()

  const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
    let query = supabase
      .from('clients')
      .select('id, name, document, phone, email, address, neighborhood, city, notes, details')
      .eq('module_id', activeModuleId)
      .in('id', ids)

    query = applyTenantFilter(query, activeTenantId, includeTenant)
    return query
  })

  if (response.error) throw response.error
  return new Map((response.data || []).map((client) => [client.id, client]))
}

const normalizeSpecies = (value) => {
  const species = String(value || '').toLowerCase()
  return ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(species) ? species : 'other'
}

function normalizeAppointmentPayload(payload = {}, moduleId) {
  const apiPayload = { ...payload }
  if (moduleId) apiPayload.module_id = moduleId

  const clientId = apiPayload.client_id || apiPayload.pet_id
  if (clientId) {
    apiPayload.client_id = clientId
    apiPayload.pet_id = apiPayload.pet_id || clientId
  }

  return apiPayload
}

async function persistAppointmentDeliveryStaff(activeModuleId, activeTenantId, appointmentId, payload = {}) {
  if (!appointmentId || !Object.prototype.hasOwnProperty.call(payload, 'delivery_staff_key')) return
  const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
    let query = supabase.from('appointments').update({ delivery_staff_key: payload.delivery_staff_key || null, delivery_staff_name: payload.delivery_staff_name || null, updated_at: new Date().toISOString() }).eq('id', appointmentId).eq('module_id', activeModuleId)
    query = applyTenantFilter(query, activeTenantId, includeTenant)
    return query
  })
  if (response.error) {
    const message = String(response.error.message || '')
    if (message.includes('delivery_staff_key') || message.includes('delivery_staff_name')) throw new Error('Aplique a migracao de motoboys operacionais antes de salvar o responsavel da entrega.')
    throw response.error
  }
}

async function ensurePetRecordForClient(activeModuleId, activeTenantId, clientId) {
  if (activeModuleId !== 'petshop' || !clientId) return clientId

  const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
    let query = supabase
      .from('clients')
      .select('id, name, phone, email, document, address, neighborhood, city, notes, details')
      .eq('module_id', activeModuleId)
      .eq('id', clientId)
      .eq('active', true)
      .single()

    query = applyTenantFilter(query, activeTenantId, includeTenant)
    return query
  })

  if (response.error) throw response.error
  const client = response.data
  if (!client?.id) throw new Error('Cliente selecionado nao encontrado.')

  const petPayload = {
    id: client.id,
    tenant_id: activeTenantId,
    module_id: activeModuleId,
    owner_name: client.name || 'Cliente',
    owner_cpf: client.document || null,
    phone: client.phone || 'sem telefone',
    email: client.email || null,
    owner_address: client.address || null,
    owner_neighborhood: client.neighborhood || null,
    owner_city: client.city || null,
    pet_name: client.details?.pet_name || client.name || 'Pet',
    species: normalizeSpecies(client.details?.species),
    breed: client.details?.breed || null,
    birth_date: client.details?.birth_date || null,
    weight_kg: client.details?.weight_kg || null,
    color: client.details?.color || null,
    notes: client.details?.pet_notes || client.notes || null,
    updated_at: new Date().toISOString(),
  }

  const petResponse = await supabase
    .from('pets')
    .upsert(petPayload, { onConflict: 'id' })
    .select('id')
    .single()

  if (petResponse.error) throw petResponse.error
  return petResponse.data?.id || client.id
}

async function findAvailableSubscriptionBenefit(moduleId, tenantId, clientId, serviceType) {
  if (moduleId !== 'petshop' || !clientId || !serviceType) return null

  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('client_subscriptions')
      .select(`
        id, services_used,
        subscription_plans ( services )
      `)
      .eq('module_id', moduleId)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })

  if (response.error || !response.data) return null

  const planServices = response.data.subscription_plans?.services || []
  const serviceConfig = planServices.find((entry) => entry?.service_type === serviceType)
  if (!serviceConfig) return null

  const used = Number(response.data.services_used?.[serviceType] || 0)
  const total = Number(serviceConfig.qty_per_cycle || 0)
  if (total <= used) return null

  return {
    subscriptionId: response.data.id,
    usage: response.data.services_used || {},
    serviceType,
    remaining: total - used,
  }
}

async function consumeSubscriptionBenefit(moduleId, tenantId, benefit) {
  if (!benefit?.subscriptionId) return

  const nextUsage = {
    ...(benefit.usage || {}),
    [benefit.serviceType]: Number(benefit.usage?.[benefit.serviceType] || 0) + 1,
  }

  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('client_subscriptions')
      .update({
        services_used: nextUsage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', benefit.subscriptionId)
      .eq('module_id', moduleId)

    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })

  if (response.error) throw response.error
}

export function useAppointments() {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const channelRef = useRef(null)
  const { activeModuleId } = useModuleCtx()
  const { activeTenantId } = useAuthCtx()

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const syncAppointmentState = (event) => {
      const detail = event?.detail || {}
      if (detail.moduleId && detail.moduleId !== activeModuleId) return
      if (detail.tenantId && activeTenantId && detail.tenantId !== activeTenantId) return
      if (detail.type === 'remove') {
        setAppointments((current) => current.filter((item) => String(item?.id) !== String(detail.id)))
        return
      }
      if (detail.appointment) setAppointments((current) => mergeAppointmentState(current, detail.appointment))
    }
    window.addEventListener(APPOINTMENT_SYNC_EVENT, syncAppointmentState)
    return () => window.removeEventListener(APPOINTMENT_SYNC_EVENT, syncAppointmentState)
  }, [activeModuleId, activeTenantId])

  const fetchAppointmentById = useCallback(async (appointmentId) => {
    if (!activeModuleId || !appointmentId) return null

    let response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('appointments')
        .select(APPOINTMENT_SELECT)
        .eq('id', appointmentId)
        .eq('module_id', activeModuleId)
        .single()

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    if (response.error && isClientRelationError(response.error)) {
      response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('appointments')
          .select(APPOINTMENT_BASE_FIELDS)
          .eq('id', appointmentId)
          .eq('module_id', activeModuleId)
          .single()

        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })

      if (response.error) throw response.error

      const clientMap = await loadClientsMap(activeModuleId, activeTenantId, [response.data?.client_id])
      const mapped = mapAppointmentRow({
        ...response.data,
        clients: clientMap.get(response.data?.client_id) || null,
      })
      return (await enrichAppointmentsWithTransport(activeModuleId, activeTenantId, [mapped]))[0] || mapped
    }

    if (response.error) throw response.error
    const mapped = mapAppointmentRow(response.data)
    return (await enrichAppointmentsWithTransport(activeModuleId, activeTenantId, [mapped]))[0] || mapped
  }, [activeModuleId, activeTenantId])

  const load = useCallback(async (filters = {}) => {
    if (!activeModuleId) return
    setLoading(true)
    setError(null)
    const tz = getTimezoneOffset()

    try {
      const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('appointments')
          .select(APPOINTMENT_SELECT)
          .eq('module_id', activeModuleId)
          .order('scheduled_at', { ascending: true })

        query = applyTenantFilter(query, activeTenantId, includeTenant)

        if (filters.startDate || filters.endDate) {
          const startDate = filters.startDate || filters.endDate
          const endDate = filters.endDate || filters.startDate
          query = query
            .gte('scheduled_at', `${startDate}T00:00:00${tz}`)
            .lte('scheduled_at', `${endDate}T23:59:59.999${tz}`)
        } else if (filters.date) {
          query = query
            .gte('scheduled_at', `${filters.date}T00:00:00${tz}`)
            .lte('scheduled_at', `${filters.date}T23:59:59.999${tz}`)
        }
        if (filters.status) query = query.eq('status', filters.status)
        if (filters.service_type) query = query.eq('service_type', filters.service_type)
        if (filters.employee_id) query = query.eq('employee_id', filters.employee_id)

        return query
      })

      if (response.error && isClientRelationError(response.error)) {
        const fallbackResponse = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
          let query = supabase
            .from('appointments')
            .select(APPOINTMENT_BASE_FIELDS)
            .eq('module_id', activeModuleId)
            .order('scheduled_at', { ascending: true })

          query = applyTenantFilter(query, activeTenantId, includeTenant)

          if (filters.startDate || filters.endDate) {
            const startDate = filters.startDate || filters.endDate
            const endDate = filters.endDate || filters.startDate
            query = query
              .gte('scheduled_at', `${startDate}T00:00:00${tz}`)
              .lte('scheduled_at', `${endDate}T23:59:59.999${tz}`)
          } else if (filters.date) {
            query = query
              .gte('scheduled_at', `${filters.date}T00:00:00${tz}`)
              .lte('scheduled_at', `${filters.date}T23:59:59.999${tz}`)
          }
          if (filters.status) query = query.eq('status', filters.status)
          if (filters.service_type) query = query.eq('service_type', filters.service_type)
          if (filters.employee_id) query = query.eq('employee_id', filters.employee_id)

          return query
        })

        if (fallbackResponse.error) throw fallbackResponse.error

        const clientMap = await loadClientsMap(activeModuleId, activeTenantId, (fallbackResponse.data || []).map((item) => item.client_id))
        const rows = (fallbackResponse.data || []).map((item) => mapAppointmentRow({
          ...item,
          clients: clientMap.get(item.client_id) || null,
        }))
        setAppointments(await enrichAppointmentsWithTransport(activeModuleId, activeTenantId, rows))
        return
      }

      if (response.error) throw response.error
      const rows = (response.data || []).map(mapAppointmentRow)
      setAppointments(await enrichAppointmentsWithTransport(activeModuleId, activeTenantId, rows))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeModuleId, activeTenantId])

  const subscribeRealtime = useCallback((date = todayISO()) => {
    if (!activeModuleId) return
    channelRef.current?.unsubscribe()
    channelRef.current = supabase
      .channel('appointments-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'appointments',
      }, () => load({ date }))
      .subscribe()
  }, [activeModuleId, load])

  useEffect(() => () => channelRef.current?.unsubscribe(), [])

  const create = useCallback(async (payload) => {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de salvar o agendamento.')
    const apiPayload = normalizeAppointmentPayload(payload, activeModuleId)
    if (apiPayload.client_id) {
      apiPayload.pet_id = await ensurePetRecordForClient(activeModuleId, activeTenantId, apiPayload.client_id)
    }

    const response = await supabase.rpc('book_petshop_appointment_transaction', {
      p_payload: {
        ...apiPayload,
        tenant_id: activeTenantId,
        module_id: activeModuleId,
        source: payload.source || 'manual',
        idempotency_key: payload.idempotency_key || crypto.randomUUID(),
      },
    })

    if (response.error) throw response.error

    await persistAppointmentDeliveryStaff(activeModuleId, activeTenantId, response.data?.appointment_id, apiPayload)
    const created = await fetchAppointmentById(response.data?.appointment_id)
    setAppointments((current) => mergeAppointmentState(current, created))
    emitAppointmentSync({ type: 'upsert', appointment: created, moduleId: activeModuleId, tenantId: activeTenantId })
    return created
  }, [activeModuleId, activeTenantId, fetchAppointmentById])

  const update = useCallback(async (id, payload) => {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de salvar o agendamento.')
    const apiPayload = normalizeAppointmentPayload(payload)
    if (apiPayload.client_id) {
      apiPayload.pet_id = await ensurePetRecordForClient(activeModuleId, activeTenantId, apiPayload.client_id)
    }

    const requiresTransaction = Boolean(
      apiPayload.services
      || apiPayload.service_type
      || apiPayload.service_group
      || apiPayload.scheduled_at
      || apiPayload.client_id
      || apiPayload.pet_id
    )

    if (requiresTransaction) {
      const response = await supabase.rpc('update_petshop_appointment_transaction', {
        p_appointment_id: id,
        p_payload: {
          ...apiPayload,
          tenant_id: activeTenantId,
          module_id: activeModuleId,
          source: payload.source || 'manual',
        },
      })
      if (response.error) {
        const message = String(response.error.message || '')
        if (message.includes('update_petshop_appointment_transaction')) {
          throw new Error('Aplique a migracao de infraestrutura da agenda antes de editar servicos.')
        }
        throw response.error
      }
    } else {
      const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('appointments')
          .update(apiPayload)
          .eq('id', id)
          .eq('module_id', activeModuleId)

        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })
      if (response.error) throw response.error
    }

    await persistAppointmentDeliveryStaff(activeModuleId, activeTenantId, id, apiPayload)
    const updated = await fetchAppointmentById(id)
    setAppointments((current) => mergeAppointmentState(current, updated))
    emitAppointmentSync({ type: 'upsert', appointment: updated, moduleId: activeModuleId, tenantId: activeTenantId })
    return updated
  }, [activeModuleId, activeTenantId, fetchAppointmentById])

  const updateStatus = (id, status, extra = {}) => {
    if (
      activeModuleId === 'petshop'
      && status === 'concluido'
      && typeof window !== 'undefined'
      && !window.confirm('O serviço, valores e cliente/pet estão preenchidos corretamente?')
    ) {
      return Promise.resolve(null)
    }
    return update(id, { status, ...extra })
  }

  const remove = useCallback(async (id) => {
    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('appointments')
        .delete()
        .eq('id', id)
        .eq('module_id', activeModuleId)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    if (response.error) throw response.error
    setAppointments((current) => current.filter((appointment) => String(appointment?.id) !== String(id)))
    emitAppointmentSync({ type: 'remove', id, moduleId: activeModuleId, tenantId: activeTenantId })
  }, [activeModuleId, activeTenantId])

  const todayStats = () => {
    const today = todayISO()
    const todayList = appointments.filter((appt) => appt.scheduled_at?.startsWith(today))
    return {
      total: todayList.length,
      agendado: todayList.filter((appt) => appt.status === 'agendado').length,
      confirmado: todayList.filter((appt) => appt.status === 'confirmado').length,
      em_andamento: todayList.filter((appt) => appt.status === 'em_andamento').length,
      concluido: todayList.filter((appt) => appt.status === 'concluido').length,
      cancelado: todayList.filter((appt) => appt.status === 'cancelado').length,
    }
  }

  const serviceLabel = (type) => {
    const labels = {
      banho: 'Banho',
      tosa: 'Tosa',
      banho_e_tosa: 'Banho & Tosa',
      escovacao: 'Escovacao',
      veterinario: 'Veterinario',
      consulta: 'Consulta',
      vacina: 'Vacina',
      motoboy: 'Motoboy/Transporte',
      outro: 'Outro',
    }
    if (labels[type]) return labels[type]
    const normalized = String(type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (/banho.*tosa|tosa.*banho/.test(normalized)) return 'Banho & Tosa'
    if (/banho/.test(normalized)) return 'Banho'
    if (/tosa|higien/.test(normalized)) return 'Tosa'
    if (/vacina/.test(normalized)) return 'Vacina'
    if (/vet|consulta|clinica|medico/.test(normalized)) return 'Veterinario'
    return type
  }

  const statusBadge = (status) => ({
    agendado: { cls: 'badge-amber', label: 'Agendado' },
    confirmado: { cls: 'badge-blue', label: 'Confirmado' },
    em_andamento: { cls: 'badge-purple', label: 'Em andamento' },
    concluido: { cls: 'badge-green', label: 'Concluido' },
    cancelado: { cls: 'badge-red', label: 'Cancelado' },
    no_show: { cls: 'badge-gray', label: 'No-show' },
  }[status] || { cls: 'badge-gray', label: status })

  return {
    appointments,
    loading,
    error,
    load,
    create,
    update,
    updateStatus,
    remove,
    subscribeRealtime,
    todayStats,
    serviceLabel,
    statusBadge,
  }
}
