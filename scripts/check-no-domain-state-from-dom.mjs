import fs from 'node:fs'

const enhancerPath = 'src/modules/petshop/components/AgendaCardLayoutEnhancer.jsx'
const agendaPath = 'src/modules/petshop/pages/AgendaPage.jsx'
const labelPath = 'src/modules/petshop/components/AgendaBillingLabel.jsx'

const enhancer = fs.readFileSync(enhancerPath, 'utf8')
const agenda = fs.readFileSync(agendaPath, 'utf8')
const label = fs.readFileSync(labelPath, 'utf8')

const forbiddenEnhancerTokens = [
  'MutationObserver',
  'querySelector',
  'textContent',
  '.dataset',
  "from '../../../lib/supabase'",
  ".from('appointments')",
]

const enhancerViolations = forbiddenEnhancerTokens.filter((token) => enhancer.includes(token))
if (enhancerViolations.length) {
  console.error(`AgendaCardLayoutEnhancer still reconstructs domain state from DOM/data: ${enhancerViolations.join(', ')}`)
  process.exit(1)
}

if (!agenda.includes("import { AgendaBillingLabel } from '../components/AgendaBillingLabel'")) {
  console.error('AgendaPage must render billing through AgendaBillingLabel.')
  process.exit(1)
}

if (!agenda.includes('data-yuisync-card-kind={billingPresentation.cardKind}')) {
  console.error('Agenda card kind must come from the appointment billing presentation model.')
  process.exit(1)
}

if (!agenda.includes('<AgendaBillingLabel appointment={appt}/>')) {
  console.error('Agenda card value must be rendered declaratively from the appointment model.')
  process.exit(1)
}

const forbiddenLabelHeuristics = [
  'price === 0',
  'price <',
  'textContent',
  'querySelector',
  'dataset',
]
const labelViolations = forbiddenLabelHeuristics.filter((token) => label.includes(token))
if (labelViolations.length) {
  console.error(`AgendaBillingLabel contains forbidden billing heuristics: ${labelViolations.join(', ')}`)
  process.exit(1)
}

console.log('No domain state is reconstructed from Agenda DOM state.')
