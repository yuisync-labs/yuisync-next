import { describe, expect, it } from 'vitest'
import {
  buildCustomerInsights,
  compareSalesPeriods,
  percentageChange,
  summarizeChatResolution,
} from './analyticsMetrics'

describe('analytics metrics', () => {
  it('compares equal sales periods and unique customers', () => {
    const result = compareSalesPeriods(
      [
        { total_price: 80, discount: 5, client_id: 'a' },
        { total_price: 120, discount: 0, client_id: 'a' },
      ],
      [{ total_price: 100, discount: 0, client_id: 'b' }],
    )

    expect(result.current).toMatchObject({ revenue: 200, count: 2, avgTicket: 100, customerCount: 1 })
    expect(result.changes).toMatchObject({ revenue: 100, avgTicket: 0, count: 100, customerCount: 0 })
    expect(percentageChange(10, 0)).toBeNull()
  })

  it('deduplicates pets by tutor and maps sales by canonical tutor id', () => {
    const clients = [
      { id: 'pet-1', name: 'Ana', phone: '1', details: { tutor_group_id: 'tutor-1', pet_name: 'Loki' } },
      { id: 'pet-2', name: 'Ana', phone: '1', details: { tutor_group_id: 'tutor-1', pet_name: 'Thor' } },
      { id: 'pet-3', name: 'Bia', phone: '2', details: { tutor_group_id: 'tutor-2', pet_name: 'Mel' } },
    ]
    const sales = [{ client_id: 'tutor-1', created_at: '2026-09-15T10:00:00Z' }]
    const result = buildCustomerInsights(clients, sales, '2026-09-01T00:00:00Z')

    expect(result.activeCount).toBe(2)
    expect(result.atRisk).toHaveLength(1)
    expect(result.atRisk[0]).toMatchObject({ id: 'tutor-2', owner_name: 'Bia', pet_name: 'Mel' })
  })

  it('ignores missing CSAT and identifies closed chats without message authorship', () => {
    const result = summarizeChatResolution(
      [
        { id: 'a', status: 'closed', csat_score: null },
        { id: 'b', status: 'closed', csat_score: 5 },
        { id: 'c', status: 'closed', csat_score: 9 },
      ],
      [
        { session_id: 'a', role: 'assistant', metadata: {} },
        { session_id: 'b', role: 'human_agent', metadata: {} },
      ],
    )

    expect(result).toMatchObject({ avgCsat: 5, csatCount: 1, aiResolved: 1, humanResolved: 1, unclassifiedResolved: 1, closedCount: 3 })
  })
})
