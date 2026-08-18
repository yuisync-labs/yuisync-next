import fs from 'node:fs'

const pagePath = 'src/modules/petshop/pages/PlanosNativePage.jsx'
const hookPath = 'src/modules/petshop/hooks/useCatalogPlans.js'
const commandsPath = 'src/modules/petshop/lib/planCommands.js'

const page = fs.readFileSync(pagePath, 'utf8')
const hook = fs.readFileSync(hookPath, 'utf8')
const commands = fs.readFileSync(commandsPath, 'utf8')

const pageForbidden = [
  'supabase.rpc(',
  'supabase.from(',
  'runWithTenantFallback',
  'applyTenantFilter',
  'message.includes(',
  'first_appointment_at',
  'recurring_appointments_created_at',
]
const pageViolations = pageForbidden.filter((token) => page.includes(token))
if (pageViolations.length) {
  console.error(`PlanosNativePage bypasses its native command boundary: ${pageViolations.join(', ')}`)
  process.exit(1)
}

for (const command of [
  'cancelSubscriptionCommand',
  'loadPackageAppointmentsCommand',
  'reschedulePackageAppointmentCommand',
  'updateSubscriptionUsageCommand',
]) {
  if (!page.includes(command)) {
    console.error(`PlanosNativePage must coordinate through ${command}.`)
    process.exit(1)
  }
}

if (!page.includes("from 'luxon'")) {
  console.error('PlanosNativePage calendar operations must use Luxon.')
  process.exit(1)
}

const hookForbidden = [
  ".insert(",
  ".update(",
  ".delete(",
  ".upsert(",
]
const hookViolations = hookForbidden.filter((token) => hook.includes(token))
if (hookViolations.length) {
  console.error(`useCatalogPlans still performs compatibility mutations directly: ${hookViolations.join(', ')}`)
  process.exit(1)
}
for (const command of ['savePlanCommand', 'saveSubscriptionCommand']) {
  if (!hook.includes(command)) {
    console.error(`useCatalogPlans must mutate through ${command}.`)
    process.exit(1)
  }
}

if (!commands.includes('/petshop/plans') || !commands.includes('/petshop/subscriptions')) {
  console.error('Plan command boundary must expose native plan/subscription endpoints.')
  process.exit(1)
}

console.log('Planos critical mutations are behind native command boundaries.')
