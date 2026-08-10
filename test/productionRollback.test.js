import { describe, expect, it } from 'vitest'
import { validateRollbackInput } from '../scripts/migration/production-rollback.mjs'

const valid = {
  mainDatabaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  authDatabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  mainBookmark: '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683',
  authBookmark: '00000086-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891684',
}

describe('production rollback input guard', () => {
  it('accepts isolated database ids and D1 bookmarks', () => {
    expect(validateRollbackInput(valid)).toBe(true)
  })

  it('rejects a database collision', () => {
    expect(() => validateRollbackInput({ ...valid, authDatabaseId: valid.mainDatabaseId })).toThrow(/COLLISION/)
  })

  it('rejects malformed bookmarks', () => {
    expect(() => validateRollbackInput({ ...valid, mainBookmark: 'not-a-bookmark' })).toThrow(/BOOKMARK_INVALID/)
  })
})
