import { describe, expect, it } from 'vitest'
import { compatMutationReturningFilters } from './supabase'

describe('compat mutation returning filters', () => {
  it('scopes a returning upsert to the explicit payload id', () => {
    expect(compatMutationReturningFilters(
      'upsert',
      { id: 'pet-nina', client_id: 'client-tutor' },
      [],
      true,
    )).toEqual([{ op: 'eq', column: 'id', value: 'pet-nina' }])
  })

  it('scopes multi-row returning mutations to all written ids', () => {
    expect(compatMutationReturningFilters(
      'insert',
      [{ id: 'a' }, { id: 'b' }, { id: 'a' }],
      [],
      true,
    )).toEqual([{ op: 'in', column: 'id', value: ['a', 'b'] }])
  })

  it('preserves an explicit id filter and does not constrain non-returning writes', () => {
    const filters = [{ op: 'eq', column: 'id', value: 'existing' }]
    expect(compatMutationReturningFilters('update', { id: 'payload' }, filters, true)).toEqual(filters)
    expect(compatMutationReturningFilters('upsert', { id: 'payload' }, [], false)).toEqual([])
  })
})
