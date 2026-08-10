import { describe, expect, it } from 'vitest'
import { classifyApexRecords, recordsToClearForCustomDomain } from '../scripts/migration/production-dns.mjs'

describe('production DNS cutover guard', () => {
  it('backs up and clears an apex CNAME before Custom Domain attach', () => {
    const records = [
      { type: 'CNAME', name: 'yuisync.app', content: 'legacy.example.com', proxied: true },
    ]
    const result = classifyApexRecords(records)
    expect(result.cnames).toHaveLength(1)
    expect(recordsToClearForCustomDomain(records)).toEqual(records)
  })

  it('backs up and clears an existing apex A record because Cloudflare rejects externally managed DNS on Custom Domain attach', () => {
    const records = [
      { type: 'A', name: 'yuisync.app', content: '192.0.2.10', proxied: true },
    ]
    const result = classifyApexRecords(records)
    expect(result.cnames).toEqual([])
    expect(result.other.map((row) => row.type)).toEqual(['A'])
    expect(recordsToClearForCustomDomain(records)).toEqual(records)
  })

  it('clears the full exact apex set while retaining its classification for reversible backup evidence', () => {
    const records = [
      { type: 'CNAME', name: 'yuisync.app', content: 'legacy.example.com', proxied: true },
      { type: 'A', name: 'yuisync.app', content: '192.0.2.10', proxied: true },
      { type: 'TXT', name: 'yuisync.app', content: 'verification=ok' },
    ]
    const result = classifyApexRecords(records)
    expect(result.cnames.map((row) => row.type)).toEqual(['CNAME'])
    expect(result.other.map((row) => row.type)).toEqual(['A', 'TXT'])
    expect(recordsToClearForCustomDomain(records).map((row) => row.type)).toEqual(['CNAME', 'A', 'TXT'])
  })
})
