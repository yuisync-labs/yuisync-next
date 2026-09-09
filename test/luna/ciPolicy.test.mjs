import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateAuditReport } from '../../scripts/check-npm-audit.mjs'

const allowlist = {
  entries: [
    {
      package: 'shell-quote',
      review_by: '2026-08-31',
      reason: 'known dependency debt',
    },
    {
      package: 'concurrently',
      via_only: ['shell-quote'],
      review_by: '2026-08-31',
      reason: 'transitive only',
    },
  ],
}

test('audit aceita pacote pai somente pela cadeia transitiva declarada', () => {
  const result = evaluateAuditReport({
    vulnerabilities: {
      'shell-quote': { severity: 'high', via: [{ severity: 'high', title: 'advisory' }] },
      concurrently: { severity: 'high', via: ['shell-quote'] },
    },
  }, allowlist, { today: '2026-07-24' })

  assert.deepEqual(result.blocking, [])
  assert.equal(result.accepted.some((entry) => entry.package === 'concurrently'), true)
})

test('audit bloqueia pacote pai se a cadeia transitiva mudar', () => {
  const result = evaluateAuditReport({
    vulnerabilities: {
      concurrently: { severity: 'high', via: ['shell-quote', 'unexpected-package'] },
    },
  }, allowlist, { today: '2026-07-24' })

  assert.equal(result.blocking[0]?.reason, 'transitive_chain_changed')
})

test('audit bloqueia advisory direto mesmo em pacote com via_only', () => {
  const result = evaluateAuditReport({
    vulnerabilities: {
      concurrently: {
        severity: 'high',
        via: [{ severity: 'high', title: 'direct advisory' }, 'shell-quote'],
      },
    },
  }, allowlist, { today: '2026-07-24' })

  assert.equal(result.blocking[0]?.reason, 'direct_advisory_not_allowlisted')
})

test('audit aceita somente os ids exatos de advisory direto declarados', () => {
  const advisoryAllowlist = {
    entries: [{ package: 'sharp', advisories_only: [1193725], review_by: '2026-09-16' }],
  }
  const accepted = evaluateAuditReport({
    vulnerabilities: {
      sharp: { severity: 'high', via: [{ source: 1193725, severity: 'high' }] },
    },
  }, advisoryAllowlist, { today: '2026-09-09' })
  assert.equal(accepted.blocking.length, 0)

  const changed = evaluateAuditReport({
    vulnerabilities: {
      sharp: { severity: 'high', via: [{ source: 9999999, severity: 'high' }] },
    },
  }, advisoryAllowlist, { today: '2026-09-09' })
  assert.equal(changed.blocking[0]?.reason, 'advisory_set_changed')
})
