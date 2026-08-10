import { describe, expect, it } from 'vitest'
import { classifyApexRecords } from '../scripts/migration/production-dns.mjs'

describe('production DNS cutover guard', () => {
  it('accepts an apex CNAME as the only record that must be cleared before Custom Domain attach', () => {
    const result = classifyApexRecords([
      { type: 'CNAME', name: 'yuisync.app', content: 'legacy.example.com', proxied: true },
    ])
    expect(result.cnames).toHaveLength(1)
    expect(result.preserved).toEqual([])
  })

  it('preserves an existing apex A record instead of deleting it blindly', () => {
    const result = classifyApexRecords([
      { type: 'A', name: 'yuisync.app', content: '192.0.2.10', proxied: true },
    ])
    expect(result.cnames).toEqual([])
    expect(result.preserved.map((row) => row.type)).toEqual(['A'])
  })

  it('separates only CNAME conflicts while retaining other apex records for rollback verification', () => {
    const result = classifyApexRecords([
      { type: 'CNAME', name: 'yuisync.app', content: 'legacy.example.com', proxied: true },
      { type: 'A', name: 'yuisync.app', content: '192.0.2.10', proxied: true },
      { type: 'TXT', name: 'yuisync.app', content: 'verification=ok' },
    ])
    expect(result.cnames.map((row) => row.type)).toEqual(['CNAME'])
    expect(result.preserved.map((row) => row.type)).toEqual(['A', 'TXT'])
  })
})
