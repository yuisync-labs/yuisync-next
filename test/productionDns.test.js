import { describe, expect, it } from 'vitest'
import { classifyApexRecords } from '../scripts/migration/production-dns.mjs'

describe('production DNS cutover guard', () => {
  it('accepts an apex CNAME as reversible cutover state', () => {
    const result = classifyApexRecords([
      { type: 'CNAME', name: 'yuisync.app', content: 'legacy.example.com', proxied: true },
    ])
    expect(result.cnames).toHaveLength(1)
    expect(result.blockers).toEqual([])
  })

  it('blocks unfamiliar apex record types instead of deleting them', () => {
    const result = classifyApexRecords([
      { type: 'CNAME', name: 'yuisync.app', content: 'legacy.example.com', proxied: true },
      { type: 'A', name: 'yuisync.app', content: '192.0.2.10', proxied: true },
    ])
    expect(result.cnames.map((row) => row.type)).toEqual(['CNAME'])
    expect(result.blockers.map((row) => row.type)).toEqual(['A'])
  })
})
