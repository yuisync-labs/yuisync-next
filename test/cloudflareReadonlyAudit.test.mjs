import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AUTH_INVARIANT_QUERIES,
  MAIN_INVARIANT_QUERIES,
  REQUIRED_AUTH_TABLES,
  REQUIRED_MAIN_TABLES,
  assertReadOnlySql,
  evaluateAudit,
  rowsFromWrangler,
} from '../scripts/migration/cloudflare-readonly-audit.mjs'

function passingInput() {
  return {
    ready: { status: 'ready' },
    mainTables: [...REQUIRED_MAIN_TABLES],
    authTables: [...REQUIRED_AUTH_TABLES],
    schemaVersion: '30',
    integrityRows: [{ integrity_check: 'ok' }],
    mainInvariantRows: Object.fromEntries(Object.keys(MAIN_INVARIANT_QUERIES).map((name) => [name, name === 'foreign_keys' ? [] : [{ count: 0 }]])),
    authInvariantRows: Object.fromEntries(Object.keys(AUTH_INVARIANT_QUERIES).map((name) => [name, [{ count: 0 }]])),
  }
}

describe('Cloudflare read-only operational audit', () => {
  it('aceita somente SQL de leitura', () => {
    assert.match(assertReadOnlySql('SELECT COUNT(*) AS count FROM appointments;'), /^SELECT/)
    assert.match(assertReadOnlySql('PRAGMA foreign_key_check;'), /^PRAGMA/)
    assert.throws(() => assertReadOnlySql('DELETE FROM appointments;'), /AUDIT_SQL_MUST_BE_READ_ONLY/)
    assert.throws(() => assertReadOnlySql('WITH x AS (SELECT 1) DELETE FROM appointments;'), /AUDIT_SQL_MUTATION_FORBIDDEN/)
  })

  it('mantem todas as consultas do certificado em modo read-only', () => {
    for (const sql of [...Object.values(MAIN_INVARIANT_QUERIES), ...Object.values(AUTH_INVARIANT_QUERIES)]) {
      assert.doesNotThrow(() => assertReadOnlySql(sql))
    }
  })

  it('normaliza a resposta JSON em lotes do Wrangler', () => {
    assert.deepEqual(rowsFromWrangler(JSON.stringify([{ results: [{ count: 0 }] }, { results: [{ count: 1 }] }])), [{ count: 0 }, { count: 1 }])
  })

  it('aprova readiness, schema v30, integridade e invariantes zeradas', () => {
    assert.deepEqual(evaluateAudit(passingInput()), {
      status: 'passed',
      schema_version: '30',
      readiness: 'ready',
      main_table_count: REQUIRED_MAIN_TABLES.length,
      auth_table_count: REQUIRED_AUTH_TABLES.length,
      invariant_count: Object.keys(MAIN_INVARIANT_QUERIES).length + Object.keys(AUTH_INVARIANT_QUERIES).length,
      failures: [],
    })
  })

  it('falha fechado para tabela ausente, FK orfa ou fixture esquecida', () => {
    const input = passingInput()
    input.mainTables = input.mainTables.filter((name) => name !== 'appointments')
    input.mainInvariantRows.foreign_keys = [{ table: 'appointments', rowid: 1 }]
    input.authInvariantRows.stale_e2e_users = [{ count: 1 }]
    const result = evaluateAudit(input)
    assert.equal(result.status, 'failed')
    assert.deepEqual(result.failures, [
      'missing_main_tables:appointments',
      'foreign_keys:1',
      'stale_e2e_users:1',
    ])
  })
})
