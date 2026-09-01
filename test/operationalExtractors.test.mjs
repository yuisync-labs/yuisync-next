import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SOURCE_TABLES } from '../scripts/migration/operationalExtractors.mjs'

describe('operational Supabase extractor schema', () => {
  it('scopes support messages by tenant without requiring a module_id column', () => {
    assert.equal(SOURCE_TABLES.support_threads.module, true)
    assert.equal(SOURCE_TABLES.support_messages.module, false)
  })
})
