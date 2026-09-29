import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildProductionWranglerConfig } from '../scripts/migration/production-cloudflare.mjs'
import { parseWranglerJson, proveProductionPrerequisites } from '../scripts/migration/production-preflight.mjs'

const valid = {
  secrets: JSON.stringify(['BETTER_AUTH_SECRET', 'AUTH_EMAIL_API_KEY', 'AUTH_EMAIL_FROM'].map((name) => ({ name }))),
  version: JSON.stringify([{ results: [{ value: '30' }] }]),
  auth: JSON.stringify([{ results: ['account', 'session', 'user', 'verification'].map((name) => ({ name })) }]),
}

describe('production Wrangler preflight', () => {
  it('accepts the real Wrangler output shape with a warning before JSON', () => {
    const warning = 'There is a newer version of Wrangler available (current: 4.134.0, latest: 4.143.0). Try upgrading.\n'
    assert.equal(proveProductionPrerequisites({
      secrets: warning + valid.secrets,
      version: warning + valid.version,
      auth: warning + valid.auth,
    }).schemaVersion, 30)
  })

  it('still rejects missing prerequisites and warning-only output', () => {
    assert.throws(() => proveProductionPrerequisites({ ...valid, secrets: '[]' }), /BETTER_AUTH_SECRET_REQUIRED/)
    assert.throws(() => proveProductionPrerequisites({ ...valid, version: '[{"results":[{"value":"24"}]}]' }), /SCHEMA_VERSION_UNSUPPORTED/)
    assert.throws(() => parseWranglerJson('There is a newer version of Wrangler available.', 'VERSION'), /VERSION_INVALID_JSON/)
  })

  it('generates valid production-scoped flags and preserves dashboard variables', () => {
    const config = buildProductionWranglerConfig({
      vars: { LUNA_PROVIDER: 'groq', LUNA_MODEL: 'openai/gpt-oss-20b' },
      env: { staging: { durable_objects: { bindings: [] } } },
    }, {
      database: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      authDatabase: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    })
    assert.equal(config.keep_vars, true)
    assert.equal(config.env.production.keep_vars, undefined)
    assert.equal(config.env.production.vars.LUNA_ENABLED, 'false')
    assert.equal(config.env.production.vars.LUNA_PLAYGROUND_ENABLED, 'false')
  })
})
