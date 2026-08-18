import fs from 'node:fs'

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${label}: target not found in ${path}`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target is not unique in ${path}`)
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

const agendaPath = 'src/modules/petshop/pages/AgendaPage.jsx'
replaceOnce(
  agendaPath,
  "import { appointmentCheckoutTotals, appointmentNeedsPayment, queueAppointmentCheckout } from './appointmentCheckoutFlow'\n",
  "import { appointmentCheckoutTotals, appointmentNeedsPayment, queueAppointmentCheckout } from './appointmentCheckoutFlow'\nimport { AgendaBillingLabel } from '../components/AgendaBillingLabel'\nimport { appointmentPackagePresentation } from '../lib/appointmentBillingPresentation'\n",
  'agenda imports',
)
replaceOnce(
  agendaPath,
  "    const sb = statusBadge(appt.status)\n    const assigned = staffById.get(appt.responsible_staff_key)\n    return (\n",
  "    const sb = statusBadge(appt.status)\n    const assigned = staffById.get(appt.responsible_staff_key)\n    const billingPresentation = appointmentPackagePresentation(appt)\n    return (\n",
  'agenda billing presentation',
)
replaceOnce(
  agendaPath,
  "        data-yuisync-native-appointment-id={String(appt.id)}\n        className={`yuisync-agenda-card-surface relative w-full rounded-lg border p-2 text-left shadow-sm ${agendaCardTone(appt.status)}`}\n",
  "        data-yuisync-native-appointment-id={String(appt.id)}\n        data-yuisync-card-kind={billingPresentation.cardKind}\n        data-yuisync-benefit-state={billingPresentation.benefitState || ''}\n        className={`yuisync-agenda-card-surface relative w-full rounded-lg border p-2 text-left shadow-sm ${agendaCardTone(appt.status)}`}\n",
  'agenda card billing attributes',
)
replaceOnce(
  agendaPath,
  "              <span className=\"shrink-0 font-bold text-emerald-400\">{fmtCurrency(appt.price)}</span>\n",
  "              <AgendaBillingLabel appointment={appt}/>\n",
  'agenda billing label',
)

replaceOnce(
  'src/shared/hooks/useAppointments.js',
  '  live_status, checkin_at, ready_at, subscription_id, subscription_benefit_used\n',
  '  live_status, checkin_at, ready_at, subscription_id, subscription_benefit_used, subscription_benefit_status, billing_intent_type, billing_intent_subscription_id\n',
  'appointment billing fields',
)

replaceOnce(
  'package.json',
  '    "check:product-ui": "node scripts/check-product-ui-boundaries.mjs",\n',
  '    "check:product-ui": "node scripts/check-product-ui-boundaries.mjs",\n    "check:no-domain-state-from-dom": "node scripts/check-no-domain-state-from-dom.mjs",\n',
  'package gate script',
)

replaceOnce(
  '.github/workflows/quality.yml',
  '      - run: npm run check:product-ui\n',
  '      - run: npm run check:product-ui\n      - run: npm run check:no-domain-state-from-dom\n',
  'quality gate',
)

console.log('PR60 codemod applied successfully.')
