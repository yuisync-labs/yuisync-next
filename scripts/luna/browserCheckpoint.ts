type TurnRow = { scenario_id: number; turn_id: number; status: string; evidence_json: string | null; created_at_ms: number }
type Scenario = { id: number; messages: readonly string[] }

// Read-only recovery. An unfinished turn remains blocked, never replayed or
// upgraded to an approved checkpoint merely because its model usage settled.
export function browserCheckpoint(scenarios: readonly Scenario[], rows: readonly TurnRow[]) {
  const receipts = rows.filter(row => row.status === 'complete').map(row => JSON.parse(row.evidence_json!))
  for (const scenario of scenarios) {
    for (let turn = 0; turn < scenario.messages.length; turn++) {
      const row = rows.find(row => row.scenario_id === scenario.id && row.turn_id === turn)
      if (!row) return { next: { scenarioId: scenario.id, turn }, blocked: null, blocker: null, complete: false, receipts }
      const receipt = row.status === 'complete' && row.evidence_json ? JSON.parse(row.evidence_json) : null
      if (!receipt?.validation?.passed || !receipt?.metrics) {
        return { next: null, blocked: { scenarioId: scenario.id, turn, status: row.status, startedAtMs: row.created_at_ms },
          blocker: row.status === 'running' ? 'TURN_STATE_UNCERTAIN' : receipt?.validation?.violations?.join(', ') || 'TURN_EVIDENCE_INCOMPLETE',
          complete: false, receipts }
      }
    }
  }
  return { next: null, blocked: null, blocker: null, complete: true, receipts }
}
