import { stableJson } from './finalSyncCore.mjs'
import { distributeWaitingGrooming } from './agendaWaitingDistribution.mjs'

const equalFields = (left, right) => Object.keys(left).filter((key) => key !== 'version')
  .every((key) => stableJson(left[key]) === stableJson(right[key]))
const keyOf = (table, row) => table === 'appointment_services' ? `${row.appointment_id}:${row.position}`
  : table === 'appointment_transport' ? row.appointment_id : table === 'module_settings_extensions' ? row.module_id : row.id

export function buildAgendaSyncPlan({ source, destination, now }) {
  const result = { inserts: {}, updates: {}, assignments: {}, protected_local: [], conflicts: [], assignment_totals: [] }
  const targetAppointments = new Map(destination.appointments.map((row) => [row.id, row]))
  const targetPets = new Map(destination.pets.map((row) => [row.id, row]))
  const sourcePets = new Map(source.pets.map((row) => [row.id, row]))
  const eligible = []
  for (const original of source.appointments) {
    const row = { ...original, client_id: targetPets.get(original.pet_id)?.client_id || sourcePets.get(original.pet_id)?.client_id || original.client_id }
    const current = targetAppointments.get(row.id)
    if (current && current.updated_at_ms > row.updated_at_ms) {
      result.protected_local.push(row.id)
      continue
    }
    if (current && current.updated_at_ms === row.updated_at_ms && !equalFields(row, current)) {
      result.conflicts.push({ table: 'appointments', id: row.id, reason: 'equal_timestamp_divergence' })
      continue
    }
    eligible.push(row)
  }

  const staff = JSON.parse(destination.module_settings_extensions[0]?.data_json || source.module_settings_extensions[0]?.data_json || '{}').petshop_operational_staff || []
  const distribution = distributeWaitingGrooming(eligible, source.appointment_services, source.services, staff)
  result.assignments = Object.fromEntries(distribution.assignments)
  result.assignment_totals = distribution.totals
  result.expected_appointments = eligible.map((row) => {
    const current = targetAppointments.get(row.id)
    const assignment = distribution.assignments.get(row.id)
    const next = assignment ? { ...row, ...assignment, updated_at_ms: now } : row
    if (!current) (result.inserts.appointments ||= []).push(next)
    else if (!equalFields(next, current)) {
      (result.updates.appointments ||= []).push({ before: current, after: { ...next, version: Number(current.version || 1) + 1 } })
    }
    return next
  })
  const eligibleIds = new Set(eligible.map((row) => row.id))
  const referencedPets = new Set(eligible.map((row) => row.pet_id).filter(Boolean))
  const referencedClients = new Set(result.expected_appointments.map((row) => row.client_id).filter(Boolean))
  for (const table of ['clients', 'pets']) {
    const known = new Set((destination[table] || []).map((row) => row.id))
    const relevant = table === 'clients' ? referencedClients : referencedPets
    result.inserts[table] = source[table].filter((row) => relevant.has(row.id) && !known.has(row.id))
  }
  for (const table of ['services', 'transport_options', 'commission_rules', 'module_settings_extensions', 'appointment_services', 'appointment_transport']) {
    const map = new Map((destination[table] || []).map((row) => [keyOf(table, row), row]))
    const child = table.startsWith('appointment_')
    for (const row of source[table] || []) {
      if (child && !eligibleIds.has(row.appointment_id)) continue
      const current = map.get(keyOf(table, row))
      if (table === 'module_settings_extensions' && current) {
        const sourceData = JSON.parse(row.data_json)
        const targetData = JSON.parse(current.data_json)
        if (Object.entries(sourceData).every(([key, value]) => stableJson(value) === stableJson(targetData[key]))) continue
        if (row.updated_at_ms > current.updated_at_ms) {
          (result.updates[table] ||= []).push({ before: current, after: { ...row, data_json: JSON.stringify({ ...targetData, ...sourceData }), version: current.version + 1 } })
        }
        continue
      }
      if (!current) (result.inserts[table] ||= []).push(row)
      else if (!equalFields(row, current)) {
        if (child || Number(row.updated_at_ms || 0) > Number(current.updated_at_ms || 0)) {
          (result.updates[table] ||= []).push({ before: current, after: row })
        } else result.conflicts.push({ table, id: keyOf(table, row), reason: 'destination_not_older' })
      }
    }
  }
  // Never delete snapshots referenced by the financial ledger. A removed service
  // needs an explicit reconciliation before this plan may be applied.
  const sourceServiceKeys = new Set(source.appointment_services.map((row) => keyOf('appointment_services', row)))
  for (const row of destination.appointment_services) {
    if (eligibleIds.has(row.appointment_id) && !sourceServiceKeys.has(keyOf('appointment_services', row))) {
      result.conflicts.push({ table: 'appointment_services', id: keyOf('appointment_services', row), reason: 'service_removed_in_legacy' })
    }
  }
  return result
}
