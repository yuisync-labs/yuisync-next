import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { unwrapD1Json } from '../scripts/migration/betterAuthCollisionPreflight.mjs'

describe('Better Auth preflight Wrangler output', () => {
  it('accepts JSON with harmless Wrangler status text around it', () => {
    const rows = unwrapD1Json('Wrangler status\n[{"results":[{"id":"u1"}],"success":true}]\nDone')
    assert.deepEqual(rows, [{ id: 'u1' }])
  })

  it('fails closed when no valid JSON payload exists', () => {
    assert.throws(
      () => unwrapD1Json('Wrangler returned no structured result'),
      (error) => error?.code === 'AUTH_PREFLIGHT_D1_JSON_INVALID',
    )
  })
})
