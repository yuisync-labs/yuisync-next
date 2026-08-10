import { describe, expect, it } from 'vitest'
import { classifyDomainRows } from '../scripts/migration/production-domain.mjs'

describe('production domain ownership guard', () => {
  it('separates the YuiSync production binding from foreign services', () => {
    const result = classifyDomainRows([
      { id: '1', hostname: 'yuisync.app', service: 'yuisync-edge-api-production' },
      { id: '2', hostname: 'yuisync.app', service: 'legacy-site' },
      { id: '3', hostname: 'www.yuisync.app', service: 'legacy-site' },
    ])

    expect(result.exact).toHaveLength(2)
    expect(result.ours.map((row) => row.id)).toEqual(['1'])
    expect(result.foreign.map((row) => row.id)).toEqual(['2'])
  })
})
