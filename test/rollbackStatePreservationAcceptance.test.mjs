import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  buildStateProof,
  stateFingerprint,
  verifyStateProof,
} from '../scripts/migration/production-state-proof.mjs'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const agendaRows = [
  { surface: 'appointments', dimension_a: 'scheduled', row_count: 2, metric_1: 20, metric_2: 120 },
  { surface: 'benefit_allocations', dimension_a: 'reserved', row_count: 2, metric_1: 11000 },
]
const financialRows = [
  { surface: 'sales', dimension_a: 'completed', row_count: 1, metric_1: 5500 },
  { surface: 'payments', dimension_a: 'received', row_count: 1, metric_1: 5500 },
]

test('INF-12 fingerprint independe da ordem das linhas e chaves', () => {
  const a = stateFingerprint(agendaRows)
  const b = stateFingerprint([
    { metric_1: 11000, row_count: 2, dimension_a: 'reserved', surface: 'benefit_allocations' },
    { metric_2: 120, metric_1: 20, row_count: 2, dimension_a: 'scheduled', surface: 'appointments' },
  ])
  assert.equal(a, b)
})

test('INF-12 detecta qualquer divergência na Agenda depois do restore', () => {
  const before = buildStateProof({ agendaRows, financialRows, capturedAt: '2026-08-20T00:00:00.000Z' })
  const changed = buildStateProof({
    agendaRows: agendaRows.map((row, index) => index === 0 ? { ...row, row_count: row.row_count + 1 } : row),
    financialRows,
  })
  assert.throws(() => verifyStateProof(changed, {
    agenda: before.agenda.sha256,
    financial: before.financial.sha256,
  }), /ROLLBACK_AGENDA_STATE_MISMATCH/)
})

test('INF-12 detecta qualquer divergência financeira depois do restore', () => {
  const before = buildStateProof({ agendaRows, financialRows })
  const changed = buildStateProof({
    agendaRows,
    financialRows: financialRows.map((row, index) => index === 0 ? { ...row, metric_1: row.metric_1 + 100 } : row),
  })
  assert.throws(() => verifyStateProof(changed, {
    agenda: before.agenda.sha256,
    financial: before.financial.sha256,
  }), /ROLLBACK_FINANCIAL_STATE_MISMATCH/)
})

test('INF-12 aceita restore somente quando Agenda e Financeiro reproduzem o snapshot', () => {
  const proof = buildStateProof({ agendaRows, financialRows })
  assert.equal(verifyStateProof(proof, {
    agenda: proof.agenda.sha256,
    financial: proof.financial.sha256,
  }), true)
})

test('INF-12 workflows capturam prova antes da migração e verificam após rollback', async () => {
  const deploy = await read('.github/workflows/production-final-deploy-v2.yml')
  const rollback = await read('.github/workflows/production-rollback.yml')
  assert.match(deploy, /production-state-proof\.mjs capture/)
  assert.match(deploy, /state-before-migration\.json/)
  assert.match(rollback, /agenda_state_sha256/)
  assert.match(rollback, /financial_state_sha256/)
  assert.match(rollback, /production-state-proof\.mjs verify/)
  assert.match(rollback, /PRODUCTION_EXPECTED_AGENDA_STATE_SHA256/)
  assert.match(rollback, /PRODUCTION_EXPECTED_FINANCIAL_STATE_SHA256/)
})
