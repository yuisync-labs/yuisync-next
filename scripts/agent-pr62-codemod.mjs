import fs from 'node:fs'

const path = 'src/modules/petshop/pages/PlanosNativePage.jsx'
let source = fs.readFileSync(path, 'utf8')

function replaceOnce(before, after, label) {
  const index = source.indexOf(before)
  if (index < 0) throw new Error(`${label}: target not found`)
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`${label}: target not unique`)
  source = source.slice(0, index) + after + source.slice(index + before.length)
}

replaceOnce(
  "import { createPortal } from 'react-dom'\n",
  "import { createPortal } from 'react-dom'\nimport { DateTime } from 'luxon'\n",
  'luxon import',
)
replaceOnce(
  "import { fmtCurrency, supabase } from '../../../lib/supabase'\nimport { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'\n",
  "import { fmtCurrency } from '../../../lib/supabase'\n",
  'remove page data facade imports',
)
replaceOnce(
  "import { useCatalogPlans } from '../hooks/useCatalogPlans'\n",
  "import { useCatalogPlans } from '../hooks/useCatalogPlans'\nimport {\n  cancelSubscriptionCommand,\n  loadPackageAppointmentsCommand,\n  publishPackageScheduleHint,\n  reschedulePackageAppointmentCommand,\n  updateSubscriptionUsageCommand,\n} from '../lib/planCommands'\n",
  'plan commands import',
)
replaceOnce(
  "const PACKAGE_SCHEDULE_SAVED_EVENT = 'yuisync:subscription-schedule-saved'\n",
  '',
  'remove event constant',
)

const oldDateHelpers = `function localDateValue(value) {
  const date = value instanceof Date ? value : new Date(value || '')
  if (Number.isNaN(date.getTime())) return ''
  return \`${'${date.getFullYear()}'}-${'${String(date.getMonth() + 1).padStart(2, \'0\')}'}-${'${String(date.getDate()).padStart(2, \'0\')}'}\`
}

function renewalStartDate(subscription = {}, pendingSubscription = null) {
  if (pendingSubscription?.first_appointment_at) return localDateValue(pendingSubscription.first_appointment_at)
  const firstAppointment = new Date(subscription.first_appointment_at || '')
  if (!Number.isNaN(firstAppointment.getTime())) {
    firstAppointment.setDate(firstAppointment.getDate() + 28)
    return localDateValue(firstAppointment)
  }
  if (subscription.next_billing_date) return String(subscription.next_billing_date).slice(0, 10)
  return localDateValue(new Date())
}

function appointmentInputParts(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  return {
    date: localDateValue(date),
    time: \`${'${String(date.getHours()).padStart(2, \'0\')}'}:${'${String(date.getMinutes()).padStart(2, \'0\')}'}\`,
  }
}

function appointmentDateTimeIso(dateValue, timeValue) {
  if (!dateValue || !timeValue) return ''
  const date = new Date(\`${'${dateValue}'}T${'${timeValue}'}:00\`)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
`
const newDateHelpers = `const PETSHOP_ZONE = 'America/Sao_Paulo'

function asPetshopDateTime(value) {
  if (value instanceof Date) return DateTime.fromJSDate(value).setZone(PETSHOP_ZONE)
  const raw = String(value || '')
  if (!raw) return DateTime.invalid('empty')
  const parsed = DateTime.fromISO(raw, { setZone: true })
  return parsed.isValid ? parsed.setZone(PETSHOP_ZONE) : DateTime.invalid('invalid')
}

function localDateValue(value) {
  const date = asPetshopDateTime(value)
  return date.isValid ? date.toISODate() : ''
}

function renewalStartDate(subscription = {}, pendingSubscription = null) {
  if (pendingSubscription?.started_at) return localDateValue(pendingSubscription.started_at)
  if (subscription.next_billing_date) return String(subscription.next_billing_date).slice(0, 10)
  const started = asPetshopDateTime(subscription.started_at)
  if (started.isValid) return started.plus({ days: 28 }).toISODate()
  return DateTime.now().setZone(PETSHOP_ZONE).toISODate()
}

function appointmentInputParts(value) {
  const date = asPetshopDateTime(value)
  if (!date.isValid) return { date: '', time: '' }
  return { date: date.toISODate(), time: date.toFormat('HH:mm') }
}

function appointmentDateTimeIso(dateValue, timeValue) {
  if (!dateValue || !timeValue) return ''
  const date = DateTime.fromISO(\`${'${dateValue}'}T${'${timeValue}'}:00\`, { zone: PETSHOP_ZONE })
  return date.isValid ? date.toUTC().toISO() : ''
}
`
replaceOnce(oldDateHelpers, newDateHelpers, 'date helpers')

replaceOnce(
  "  const runScoped = useMemo(() => (runner) => runWithTenantFallback(activeTenantId, runner), [activeTenantId])\n",
  '',
  'modal scoped runner',
)
const oldLoad = `      const response = await runScoped(async (includeTenant) => {
        let query = supabase
          .from('appointments')
          .select('id,scheduled_at,status,service_type,service_items,notes,source')
          .eq('module_id', moduleId)
          .eq('subscription_id', subscription.id)
          .order('scheduled_at', { ascending: true })
        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })
      if (response.error) throw response.error
      setRows((response.data || []).map((appointment) => ({
`
const newLoad = `      const appointments = await loadPackageAppointmentsCommand({
        tenantId: activeTenantId,
        moduleId,
        subscriptionId: subscription.id,
      })
      setRows(appointments.map((appointment) => ({
`
replaceOnce(oldLoad, newLoad, 'load package appointments')

const oldRpc = `        const response = await supabase.rpc('update_petshop_appointment_transaction', {
          p_appointment_id: row.id,
          p_payload: {
            tenant_id: activeTenantId,
            module_id: moduleId,
            scheduled_at: row.next_scheduled_at,
            source: row.source || 'package_activation',
          },
        })
        if (response.error) throw response.error
`
const newRpc = `        await reschedulePackageAppointmentCommand({
          tenantId: activeTenantId,
          moduleId,
          appointmentId: row.id,
          scheduledAt: row.next_scheduled_at,
          source: row.source || 'package_activation',
        })
`
replaceOnce(oldRpc, newRpc, 'reschedule command')

const oldFirstAt = `      if (firstAt) {
        const response = await runScoped(async (includeTenant) => {
          let query = supabase
            .from('client_subscriptions')
            .update({ first_appointment_at: firstAt, updated_at: new Date().toISOString() })
            .eq('id', subscription.id)
            .eq('module_id', moduleId)
          query = applyTenantFilter(query, activeTenantId, includeTenant)
          return query.select('id,first_appointment_at').single()
        })
        if (response.error) throw response.error
      }
`
replaceOnce(
  oldFirstAt,
  `      if (firstAt) publishPackageScheduleHint({ subscriptionId: subscription.id, firstAppointmentAt: firstAt })\n`,
  'remove phantom schedule columns',
)
const oldCatch = `    } catch (saveError) {
      const message = String(saveError?.message || '')
      setError(message.includes('update_petshop_appointment_transaction')
        ? 'A infraestrutura de edição da Agenda ainda não foi aplicada no banco.'
        : message || 'Não foi possível atualizar os agendamentos do pacote.')
    } finally {
`
const newCatch = `    } catch (saveError) {
      const code = String(saveError?.code || '')
      const message = String(saveError?.message || '')
      setError(code === 'APPOINTMENT_UPDATE_UNAVAILABLE'
        ? 'A infraestrutura de edição da Agenda ainda não está disponível.'
        : message || 'Não foi possível atualizar os agendamentos do pacote.')
    } finally {
`
replaceOnce(oldCatch, newCatch, 'typed appointment error')

replaceOnce(
  "  const runScoped = useMemo(() => (runner) => runWithTenantFallback(activeTenantId, runner), [activeTenantId])\n",
  '',
  'page scoped runner',
)
replaceOnce(
  "    && subscription.next_billing_date === new Date().toISOString().slice(0, 10)\n",
  "    && subscription.next_billing_date === DateTime.now().setZone(PETSHOP_ZONE).toISODate()\n",
  'renewals today',
)

const oldPersist = `  async function persistPendingSchedule(subscription) {
    if (subscription?.status !== 'pending_payment') return subscription
    const firstAt = window.sessionStorage.getItem(PACKAGE_FIRST_APPOINTMENT_STORAGE_KEY)
      || subscription.first_appointment_at
    if (!firstAt) throw new Error('Informe a primeira data e o horário fixo antes de abrir o pagamento.')

    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('client_subscriptions')
        .update({
          first_appointment_at: firstAt,
          recurring_appointments_created_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', subscription.id)
        .eq('module_id', moduleId)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query.select('id,first_appointment_at').single()
    })
    if (response.error) throw response.error

    window.sessionStorage.removeItem(PACKAGE_FIRST_APPOINTMENT_STORAGE_KEY)
    window.dispatchEvent(new CustomEvent(PACKAGE_SCHEDULE_SAVED_EVENT, {
      detail: { subscriptionId: subscription.id, firstAppointmentAt: firstAt },
    }))
    return { ...subscription, first_appointment_at: firstAt }
  }
`
const newPersist = `  async function persistPendingSchedule(subscription) {
    if (subscription?.status !== 'pending_payment') return subscription
    const firstAt = window.sessionStorage.getItem(PACKAGE_FIRST_APPOINTMENT_STORAGE_KEY)
    if (firstAt) publishPackageScheduleHint({ subscriptionId: subscription.id, firstAppointmentAt: firstAt })
    return subscription
  }
`
replaceOnce(oldPersist, newPersist, 'pending schedule hint')
replaceOnce(
  '    if (pendingRenewal?.first_appointment_at) {\n',
  '    if (pendingRenewal) {\n',
  'pending renewal identity',
)

const oldSaveUsage = `  async function saveUsage(subscription, requested) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de editar o consumo.')
    const servicesUsed = clampSubscriptionUsage(subscription, requested)
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('client_subscriptions')
        .update({ services_used: servicesUsed, updated_at: new Date().toISOString() })
        .eq('id', subscription.id)
        .eq('module_id', moduleId)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query.select('id,services_used').single()
    })
    if (response.error) throw response.error
    await reload()
  }
`
const newSaveUsage = `  async function saveUsage(subscription, requested) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de editar o consumo.')
    const servicesUsed = clampSubscriptionUsage(subscription, requested)
    await updateSubscriptionUsageCommand({
      tenantId: activeTenantId,
      moduleId,
      subscriptionId: subscription.id,
      servicesUsed,
    })
    await reload()
  }
`
replaceOnce(oldSaveUsage, newSaveUsage, 'usage command')

const oldCancel = `  async function cancelSubscription(subscription) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de cancelar.')
    const response = await runScoped(async (includeTenant) => {
      let query = supabase
        .from('client_subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', subscription.id)
        .eq('module_id', moduleId)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query.select('id,status').single()
    })
    if (response.error) throw response.error
    await reload()
  }
`
const newCancel = `  async function cancelSubscription(subscription) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de cancelar.')
    await cancelSubscriptionCommand({ tenantId: activeTenantId, moduleId, subscriptionId: subscription.id })
    await reload()
  }
`
replaceOnce(oldCancel, newCancel, 'cancel command')

fs.writeFileSync(path, source)
console.log('PR62 Planos codemod applied.')
