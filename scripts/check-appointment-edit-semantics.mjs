import fs from 'node:fs'

const hookPath = 'src/shared/hooks/useAppointments.js'
const source = fs.readFileSync(hookPath, 'utf8')

const marker = 'const requiresTransaction = Boolean('
const start = source.indexOf(marker)
if (start < 0) {
  console.error('useAppointments must keep an explicit requiresTransaction decision for appointment edits.')
  process.exit(1)
}
const end = source.indexOf('\n    )', start)
if (end < 0) {
  console.error('Could not parse the appointment transaction decision block.')
  process.exit(1)
}
const block = source.slice(start, end)

const requiredTransactional = ['services', 'service_type', 'service_group', 'scheduled_at', 'client_id', 'pet_id']
const forbiddenSignals = [
  'price',
  'responsible_staff_key',
  'responsible_staff_name',
  'notes',
  'status',
  'transport_mode',
  'transport_label',
  'transport_address',
  'transport_neighborhood',
  'transport_city',
  'transport_reference',
]

const missing = requiredTransactional.filter((field) => !block.includes(`apiPayload.${field}`))
const forbidden = forbiddenSignals.filter((field) => block.includes(`apiPayload.${field}`))

if (missing.length || forbidden.length) {
  console.error(JSON.stringify({
    message: 'Appointment semantic update routing drifted.',
    missing_transactional_fields: missing,
    forbidden_transaction_signals: forbidden,
  }, null, 2))
  process.exit(1)
}

console.log('Appointment update routing preserves semantic field boundaries.')
