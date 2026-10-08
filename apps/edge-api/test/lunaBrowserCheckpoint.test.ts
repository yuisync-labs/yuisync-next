import { describe, expect, it } from 'vitest'
import { browserCheckpoint } from '../../../scripts/luna/browserCheckpoint'
import { certificationPlayground } from '../../../scripts/luna/certificationPlayground'

const scenarios = [{ id: 1, messages: ['Produto', 'Retirada', 'Confirmo'] }]
const evidence = { scenario_id: 1, turn_id: 0, metrics: { calls: 4 }, validation: { passed: true, violations: [] }, messages: [{ role: 'assistant', content: 'Retirada ou entrega?' }] }
const row = { scenario_id: 1, turn_id: 0, status: 'complete', evidence_json: JSON.stringify(evidence), created_at_ms: 1000 }

describe('Browser certification recovery — read only', () => {
 it('keeps prior transcripts visible and blocks the observed unfinished turn without replay', () => {
  const state = browserCheckpoint(scenarios, [row, { ...row, turn_id: 1, status: 'running', evidence_json: null, created_at_ms: 2000 }])
  expect(state.next).toBeNull()
  expect(state.complete).toBe(false)
  expect(state.blocker).toBe('TURN_STATE_UNCERTAIN')
  expect(state.blocked).toEqual({ scenarioId: 1, turn: 1, status: 'running', startedAtMs: 2000 })
  expect(state.receipts).toEqual([evidence])
 })
 it('does not approve missing metrics or failed validation', () => {
  for (const change of [{ metrics: null }, { validation: { passed: false, violations: ['PICKUP_SUMMARY_NOT_PRESENTED'] } }]) {
   const state = browserCheckpoint(scenarios, [{ ...row, evidence_json: JSON.stringify({ ...evidence, ...change }) }])
   expect(state.next).toBeNull(); expect(state.complete).toBe(false); expect(state.blocker).toBeTruthy()
  }
 })
 it('advances only to an unexecuted turn and completes only after all receipts pass', () => {
  expect(browserCheckpoint(scenarios, [row]).next).toEqual({ scenarioId: 1, turn: 1 })
  expect(browserCheckpoint(scenarios, [0, 1, 2].map(turn_id => ({ ...row, turn_id }))).complete).toBe(true)
 })
 it('renders a blocked scenario separately from the authorized next turn', async () => {
  const html = await certificationPlayground('fixture').text()
  expect(html).toContain('const visible=current||state.blocked')
  expect(html).toContain('lastCompletedReceipt')
  expect(html).toContain('Estado e consumo foram preservados; não reenvie')
  expect(html).toContain('busy||!current')
 })
})
