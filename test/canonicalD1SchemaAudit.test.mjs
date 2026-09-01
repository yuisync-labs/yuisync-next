import assert from 'node:assert/strict'
import test from 'node:test'

import { auditCanonicalD1Schema, buildD1SchemaAuditQuery } from '../scripts/migration/canonicalD1SchemaAudit.mjs'

test('canonical D1 schema audit accepts matching required columns and returns the primary key', () => {
  const report = auditCanonicalD1Schema({
    collections: { pets: [{ tenant_id: 't1', id: 'p1', name: 'Nina' }] },
    schemaRows: [
      { table_name: 'pets', column_name: 'tenant_id', is_required: 1, default_value: null, primary_key_position: 1 },
      { table_name: 'pets', column_name: 'id', is_required: 1, default_value: null, primary_key_position: 2 },
      { table_name: 'pets', column_name: 'name', is_required: 1, default_value: null, primary_key_position: 0 },
      { table_name: 'pets', column_name: 'notes', is_required: 0, default_value: null, primary_key_position: 0 },
    ],
  })
  assert.equal(report.compatible, true)
  assert.deepEqual(report.tables.pets.primary_key, ['tenant_id', 'id'])
})

test('canonical D1 schema audit exposes projection drift', () => {
  const report = auditCanonicalD1Schema({
    collections: { booking_hours: [{ tenant_id: 't1', open_minute: 540 }] },
    schemaRows: [
      { table_name: 'booking_hours', column_name: 'tenant_id', is_required: 1, default_value: null, primary_key_position: 1 },
      { table_name: 'booking_hours', column_name: 'opens_minute', is_required: 1, default_value: null, primary_key_position: 2 },
    ],
  })
  assert.equal(report.compatible, false)
  assert.deepEqual(report.tables.booking_hours.missing_destination_columns, ['open_minute'])
  assert.deepEqual(report.tables.booking_hours.missing_required_source_columns, ['opens_minute'])
})

test('schema audit query only includes safe normalized table names', () => {
  const query = buildD1SchemaAuditQuery(['pets', 'clients', 'pets', 'bad;drop'])
  assert.match(query, /'clients','pets'/)
  assert.doesNotMatch(query, /drop/u)
})
