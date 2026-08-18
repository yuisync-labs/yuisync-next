import fs from 'node:fs'

const path = 'src/modules/petshop/pages/PlanosNativePage.jsx'
let s = fs.readFileSync(path, 'utf8')

function exact(before, after, label) {
  if (!s.includes(before)) throw new Error(`${label}: target not found`)
  s = s.replace(before, after)
}
function regex(pattern, after, label) {
  if (!pattern.test(s)) throw new Error(`${label}: target not found`)
  s = s.replace(pattern, after)
}

exact("import { createPortal } from 'react-dom'\n", "import { createPortal } from 'react-dom'\nimport { DateTime } from 'luxon'\n", 'luxon')
exact("import { fmtCurrency, supabase } from '../../../lib/supabase'\nimport { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'\n", "import { fmtCurrency } from '../../../lib/supabase'\n", 'data facade imports')
exact("import { useCatalogPlans } from '../hooks/useCatalogPlans'\n", `import { useCatalogPlans } from '../hooks/useCatalogPlans'
import {
  cancelSubscriptionCommand,
  loadPackageAppointmentsCommand,
  publishPackageScheduleHint,
  reschedulePackageAppointmentCommand,
  updateSubscriptionUsageCommand,
} from '../lib/planCommands'
`, 'commands import')
s = s.replace("const PACKAGE_SCHEDULE_SAVED_EVENT = 'yuisync:subscription-schedule-saved'\n", '')

regex(
  /function localDateValue\(value\) \{[\s\S]*?function packageAppointmentServiceLabel/,
  `const PETSHOP_ZONE = 'America/Sao_Paulo'

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

function packageAppointmentServiceLabel`,
  'calendar helpers',
)

s = s.replaceAll("  const runScoped = useMemo(() => (runner) => runWithTenantFallback(activeTenantId, runner), [activeTenantId])\n", '')

regex(
  /      const response = await runScoped\(async \(includeTenant\) => \{[\s\S]*?      setRows\(\(response\.data \|\| \[\]\)\.map\(\(appointment\) => \(\{/,
  `      const appointments = await loadPackageAppointmentsCommand({
        tenantId: activeTenantId,
        moduleId,
        subscriptionId: subscription.id,
      })
      setRows(appointments.map((appointment) => ({`,
  'load package appointments',
)

regex(
  /        const response = await supabase\.rpc\('update_petshop_appointment_transaction',[\s\S]*?        if \(response\.error\) throw response\.error\n/,
  `        await reschedulePackageAppointmentCommand({
          tenantId: activeTenantId,
          moduleId,
          appointmentId: row.id,
          scheduledAt: row.next_scheduled_at,
          source: row.source || 'package_activation',
        })
`,
  'reschedule package appointment',
)

regex(
  /      if \(firstAt\) \{\n        const response = await runScoped[\s\S]*?        if \(response\.error\) throw response\.error\n      \}\n/,
  `      if (firstAt) publishPackageScheduleHint({ subscriptionId: subscription.id, firstAppointmentAt: firstAt })
`,
  'phantom first appointment write',
)

regex(
  /    \} catch \(saveError\) \{\n      const message = String\(saveError\?\.message \|\| ''\)\n      setError\(message\.includes\('update_petshop_appointment_transaction'\)[\s\S]*?    \} finally \{/,
  `    } catch (saveError) {
      const code = String(saveError?.code || '')
      const message = String(saveError?.message || '')
      setError(code === 'APPOINTMENT_UPDATE_UNAVAILABLE'
        ? 'A infraestrutura de edição da Agenda ainda não está disponível.'
        : message || 'Não foi possível atualizar os agendamentos do pacote.')
    } finally {`,
  'typed appointment error',
)

exact("    && subscription.next_billing_date === new Date().toISOString().slice(0, 10)\n", "    && subscription.next_billing_date === DateTime.now().setZone(PETSHOP_ZONE).toISODate()\n", 'renewals today')

regex(
  /  async function persistPendingSchedule\(subscription\) \{[\s\S]*?\n  \}\n\n  async function handleSaveSubscription/,
  `  async function persistPendingSchedule(subscription) {
    if (subscription?.status !== 'pending_payment') return subscription
    const firstAt = window.sessionStorage.getItem(PACKAGE_FIRST_APPOINTMENT_STORAGE_KEY)
    if (firstAt) publishPackageScheduleHint({ subscriptionId: subscription.id, firstAppointmentAt: firstAt })
    return subscription
  }

  async function handleSaveSubscription`,
  'pending schedule metadata',
)

s = s.replace('    if (pendingRenewal?.first_appointment_at) {\n', '    if (pendingRenewal) {\n')

regex(
  /  async function saveUsage\(subscription, requested\) \{[\s\S]*?\n  \}\n\n  async function cancelSubscription/,
  `  async function saveUsage(subscription, requested) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de editar o consumo.')
    const servicesUsed = clampSubscriptionUsage(subscription, requested)
    await updateSubscriptionUsageCommand({ tenantId: activeTenantId, moduleId, subscriptionId: subscription.id, servicesUsed })
    await reload()
  }

  async function cancelSubscription`,
  'usage command',
)

regex(
  /  async function cancelSubscription\(subscription\) \{[\s\S]*?\n  \}\n\n  return \(/,
  `  async function cancelSubscription(subscription) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de cancelar.')
    await cancelSubscriptionCommand({ tenantId: activeTenantId, moduleId, subscriptionId: subscription.id })
    await reload()
  }

  return (`,
  'cancel command',
)

if (/\bsupabase\b|runWithTenantFallback|applyTenantFilter|\.rpc\(|\.from\(|message\.includes\(/.test(s)) {
  throw new Error('PlanosNativePage still contains a forbidden data/mutation primitive after codemod')
}
if (/first_appointment_at|recurring_appointments_created_at/.test(s)) {
  throw new Error('PlanosNativePage still depends on phantom subscription scheduling columns')
}

fs.writeFileSync(path, s)
console.log('PR62 Planos codemod v3 applied.')
