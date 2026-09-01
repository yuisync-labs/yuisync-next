import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCanonicalD1Sql, createCanonicalD1Writer, CanonicalD1WriterError } from '../scripts/migration/canonicalD1Writer.mjs'

const schemaRows = [
  { table_name:'pets', column_name:'tenant_id', is_required:1, default_value:null, primary_key_position:1 },
  { table_name:'pets', column_name:'module_id', is_required:1, default_value:null, primary_key_position:2 },
  { table_name:'pets', column_name:'id', is_required:1, default_value:null, primary_key_position:3 },
  { table_name:'pets', column_name:'name', is_required:1, default_value:null, primary_key_position:0 },
]

test('canonical writer produces retry-safe scoped inserts', () => {
  const result = buildCanonicalD1Sql({
    collections:{ pets:[{ tenant_id:'tenant-1', module_id:'petshop', id:'pet-1', name:"D'Água" }] },
    schemaRows, tenantId:'tenant-1', moduleId:'petshop',
  })
  assert.equal(result.rowCount, 1)
  assert.match(result.sql, /WHERE NOT EXISTS\(SELECT 1 FROM pets WHERE tenant_id='tenant-1' AND module_id='petshop' AND id='pet-1'\)/u)
  assert.match(result.sql, /D''Água/u)
})

test('canonical writer blocks production without run-specific authorization', async () => {
  const writer = createCanonicalD1Writer({ environment:'production', execFile:async () => ({ stdout:'' }) })
  await assert.rejects(
    writer({ runId:'run-1', collections:{ pets:[] }, schemaRows, tenantId:'tenant-1' }),
    (error) => error instanceof CanonicalD1WriterError && error.code === 'PRODUCTION_NOT_AUTHORIZED',
  )
})

test('canonical writer retries a transient D1 write without duplicating the batch', async () => {
  let attempts = 0
  const writer = createCanonicalD1Writer({
    environment:'staging',
    execFile:async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary remote failure')
      return { stdout:'' }
    },
  })

  const result = await writer({
    runId:'run-retry',
    collections:{ pets:[{ tenant_id:'tenant-1', module_id:'petshop', id:'pet-1', name:'Pipoca' }] },
    schemaRows,
    tenantId:'tenant-1',
  })

  assert.equal(attempts, 2)
  assert.equal(result.status, 'applied_or_already_present')
  assert.equal(result.rowCount, 1)
})
