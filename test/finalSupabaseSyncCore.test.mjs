import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildInsertStatement,
  buildUpdateStatement,
  buildUpsertStatement,
  planCanonicalRows,
  selectChangedRows,
  snapshotHash,
} from '../scripts/migration/legacy-supabase/finalSyncCore.mjs'

describe('final legacy Supabase sync core', () => {
  it('is deterministic and plans inserts, newer updates, and conflicts', () => {
    assert.equal(snapshotHash({ b:[{ y:2,x:1 }],a:[] }), snapshotHash({ a:[],b:[{ x:1,y:2 }] }))
    const plan = planCanonicalRows({
      primaryKey:['id'],
      sourceRows:[
        { id:'new',value:'a',updated_at_ms:2 },
        { id:'update',value:'source',updated_at_ms:3 },
        { id:'keep',value:'same',updated_at_ms:4 },
        { id:'conflict',value:'source',updated_at_ms:4 },
      ],
      destinationRows:[
        { id:'update',value:'destination',updated_at_ms:2 },
        { id:'keep',value:'same',updated_at_ms:4 },
        { id:'conflict',value:'destination',updated_at_ms:5 },
      ],
    })
    assert.deepEqual(plan.inserts.map((row) => row.id), ['new'])
    assert.deepEqual(plan.updates.map((row) => row.id), ['update'])
    assert.deepEqual(plan.unchanged.map((row) => row.id), ['keep'])
    assert.equal(plan.conflicts[0].reason, 'destination_newer')
  })

  it('ignores destination-only columns maintained by native D1 triggers', () => {
    const source = { tenant_id:'tenant', module_id:'petshop', id:'appointment', status:'scheduled', updated_at_ms:10 }
    const destination = { ...source, operation_fingerprint:'native-derived-value' }
    const result = planCanonicalRows({
      sourceRows:[source],
      destinationRows:[destination],
      primaryKey:['tenant_id', 'module_id', 'id'],
    })
    assert.equal(result.unchanged.length, 1)
    assert.equal(result.conflicts.length, 0)
  })

  it('selects changed parents and their dependency rows without deletions', () => {
    const selected = selectChangedRows({
      appointments:[{ id:'a1',updated_at_ms:20 },{ id:'old',updated_at_ms:1 }],
      appointment_services:[{ appointment_id:'a1',position:0,created_at_ms:1 }],
      sales:[{ id:'s1',updated_at_ms:20 }],
      sale_items:[{ sale_id:'s1',position:0,created_at_ms:1 }],
    }, { startMs:10,cutoffMs:30 })
    assert.deepEqual(selected.appointments.map((row) => row.id), ['a1'])
    assert.equal(selected.appointment_services.length, 1)
    assert.equal(selected.sale_items.length, 1)
  })

  it('guards upserts so an older source cannot overwrite a newer D1 row', () => {
    const sql = buildUpsertStatement('appointments', { id:'a1',status:'completed',updated_at_ms:20 }, ['id'])
    assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/)
    assert.match(sql, /WHERE excluded\.updated_at_ms > appointments\.updated_at_ms/)
    assert.doesNotMatch(sql, /DELETE/u)
  })

  it('uses distinct insert and update statements so D1 insert triggers do not double-count existing rows', () => {
    const row = { tenant_id:'tenant', module_id:'petshop', id:'allocation', state:'consumed', updated_at_ms:20 }
    assert.equal(
      buildInsertStatement('subscription_benefit_allocations', row),
      "INSERT INTO subscription_benefit_allocations(id,module_id,state,tenant_id,updated_at_ms) VALUES('allocation','petshop','consumed','tenant',20);",
    )
    const update = buildUpdateStatement(
      'subscription_benefit_allocations',
      row,
      ['tenant_id', 'module_id', 'id'],
    )
    assert.match(update, /^UPDATE subscription_benefit_allocations SET /)
    assert.match(update, /WHERE tenant_id='tenant' AND module_id='petshop' AND id='allocation' AND updated_at_ms < 20;$/)
    assert.doesNotMatch(update, /INSERT INTO/)
  })
})
