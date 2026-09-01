import { supabase, todayISO } from '../../../lib/supabase'
import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../../lib/tenant'
import {
  buildCashDashboardSummary,
  isPackageCoveredAppointment,
  resolveCashPeriod,
} from './cashRegisterSummary'

const CLIENT_SELECT = 'id,name,phone,email,address,neighborhood,city,details'

const getDateBounds = (date) => ({
  start: new Date(`${date}T00:00:00`).toISOString(),
  end: new Date(`${date}T23:59:59.999`).toISOString(),
})

const isSplitSchemaError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('sale_payment_splits') && (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('relation')
    || message.includes('column')
  )
}

const formatClient = (client = {}) => ({
  id: client.id,
  owner_name: client.name || '',
  phone: client.phone || '',
  pet_name: client.details?.pet_name || client.name || '',
  breed: client.details?.breed || '',
})

const assertTenant = (tenantId) => {
  if (!tenantId) throw new Error('Selecione uma empresa ativa antes de operar o caixa.')
}

async function currentProfileId() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data?.user?.id || null
}

async function loadClientMap({ tenantId, moduleId, clientIds = [] }) {
  const ids = [...new Set(clientIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase.from('clients').select(CLIENT_SELECT).eq('module_id', moduleId).in('id', ids)
    return applyTenantFilter(query, tenantId, includeTenant)
  })
  if (response.error) throw response.error
  return new Map((response.data || []).map((client) => [client.id, client]))
}

export async function loadCashDashboardSnapshot({ tenantId, moduleId = 'petshop' } = {}) {
  assertTenant(tenantId)
  const runScoped = (runner) => runWithTenantFallback(tenantId, runner)
  const { start: dayStart, end: dayEnd } = getDateBounds(todayISO())

  const registerResponse = await runScoped(async (includeTenant) => {
    let query = supabase.from('cash_register').select('*').eq('module_id', moduleId).order('opened_at', { ascending: false }).limit(30)
    return applyTenantFilter(query, tenantId, includeTenant)
  })
  if (registerResponse.error) throw registerResponse.error

  const registers = registerResponse.data || []
  const current = registers.find((register) => !register.closed_at) || null
  const period = resolveCashPeriod({ openedAt: current?.opened_at, dayStart, dayEnd })

  const salesResponse = await runScoped(async (includeTenant) => {
    let query = supabase
      .from('sales')
      .select('id,appointment_id,subscription_id,client_id,customer_name,total_price,payment_method,created_at,status,source,fulfillment_type,notes')
      .eq('module_id', moduleId)
      .eq('status', 'concluido')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
      .order('created_at', { ascending: false })
    return applyTenantFilter(query, tenantId, includeTenant)
  })
  if (salesResponse.error) throw salesResponse.error
  const sales = salesResponse.data || []

  let splitRows = []
  const saleIds = sales.map((sale) => sale.id).filter(Boolean)
  if (saleIds.length) {
    const splitsResponse = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('sale_payment_splits')
        .select('sale_id,payment_method,amount,position')
        .eq('module_id', moduleId)
        .in('sale_id', saleIds)
      return applyTenantFilter(query, tenantId, includeTenant)
    })
    if (splitsResponse.error && !isSplitSchemaError(splitsResponse.error)) throw splitsResponse.error
    splitRows = splitsResponse.error ? [] : (splitsResponse.data || [])
  }

  const appointmentsResponse = await runScoped(async (includeTenant) => {
    let query = supabase
      .from('appointments')
      .select('id,client_id,scheduled_at,updated_at,price,status,service_type,service_group,service_items,subscription_benefit_status,subscription_benefits,subscription_label,subscription_discount')
      .eq('module_id', moduleId)
      .eq('status', 'concluido')
      .gte('updated_at', period.start)
      .lte('updated_at', period.end)
      .order('updated_at', { ascending: false })
    return applyTenantFilter(query, tenantId, includeTenant)
  })
  if (appointmentsResponse.error) throw appointmentsResponse.error

  const appointmentRows = appointmentsResponse.data || []
  const saleAppointmentMap = new Map(appointmentRows.map((appointment) => [appointment.id, appointment]))
  const soldAppointmentIds = new Set(sales.map((sale) => String(sale.appointment_id || '')).filter(Boolean))
  const candidateAppointments = appointmentRows.filter((appointment) => (
    !soldAppointmentIds.has(String(appointment.id)) && isPackageCoveredAppointment(appointment)
  ))
  const clientMap = await loadClientMap({
    tenantId,
    moduleId,
    clientIds: [
      ...candidateAppointments.map((appointment) => appointment.client_id),
      ...sales.map((sale) => sale.client_id || saleAppointmentMap.get(sale.appointment_id)?.client_id),
    ],
  })
  const enrichedSales = sales.map((sale) => {
    const clientId = sale.client_id || saleAppointmentMap.get(sale.appointment_id)?.client_id
    return {
      ...sale,
      client: clientId ? formatClient(clientMap.get(clientId) || {}) : null,
    }
  })
  const packageAppointments = candidateAppointments.map((appointment) => ({
    ...appointment,
    client: formatClient(clientMap.get(appointment.client_id) || {}),
  }))

  const summary = buildCashDashboardSummary({ sales: enrichedSales, splitRows, packageAppointments })
  return { registers, current, sales: enrichedSales, packageAppointments, period, ...summary }
}

export async function openCashRegisterSnapshot({ tenantId, moduleId = 'petshop', openingBalance = 0, notes = '' } = {}) {
  assertTenant(tenantId)
  const profileId = await currentProfileId()
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    const row = buildTenantPayload({
      module_id: moduleId,
      opened_by: profileId,
      opening_balance: Number(openingBalance || 0),
      notes: notes || null,
    }, tenantId, includeTenant)
    return supabase.from('cash_register').insert(row).select('*').single()
  })
  if (response.error) throw response.error
  return response.data
}

export async function closeCashRegisterSnapshot({ tenantId, moduleId = 'petshop', registerId, closingBalance = 0, notes = '' } = {}) {
  assertTenant(tenantId)
  const dashboard = await loadCashDashboardSnapshot({ tenantId, moduleId })
  const current = dashboard.current
  if (!current || current.id !== registerId) throw new Error('Nenhum caixa aberto encontrado.')

  const expectedBalance = Number(current.opening_balance || 0) + Number(dashboard.expectedCash || 0)
  const counted = Number(closingBalance || 0)
  const profileId = await currentProfileId()
  const response = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase.from('cash_register').update({
      closed_by: profileId,
      closing_balance: counted,
      expected_balance: expectedBalance,
      difference: counted - expectedBalance,
      closed_at: new Date().toISOString(),
      notes: notes || current.notes || null,
    }).eq('id', registerId).eq('module_id', moduleId).select('*').single()
    return applyTenantFilter(query, tenantId, includeTenant)
  })
  if (response.error) throw response.error
  return response.data
}
