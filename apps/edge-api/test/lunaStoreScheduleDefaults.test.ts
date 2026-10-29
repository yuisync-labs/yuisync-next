import { describe, expect, it } from 'vitest'
import { withStoreScheduleDefaults } from '../src/luna/schedulePolicy'

const db = (timezone: string | null) => ({ prepare: () => ({ bind: () => ({ first: async () => timezone ? { timezone } : null }) }) }) as unknown as D1Database
const hours = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(day => [String(day), [{ open: '08:00', close: '18:00' }]]))

describe('booking schedule falls back to the store settings', () => {
  it('uses the store opening hours and module timezone when booking keys are absent', async () => {
    expect(await withStoreScheduleDefaults(db('America/Sao_Paulo'), 't', 'petshop', { store_business_hours: hours })).toMatchObject({ petbot_business_hours: hours, petbot_timezone: 'America/Sao_Paulo' })
  })
  it('keeps explicit booking settings', async () => {
    const own = { ...hours, 1: [{ open: '09:00', close: '12:00' }] }
    expect(await withStoreScheduleDefaults(db('America/Sao_Paulo'), 't', 'petshop', { store_business_hours: hours, petbot_business_hours: own, petbot_timezone: 'America/Manaus' })).toMatchObject({ petbot_business_hours: own, petbot_timezone: 'America/Manaus' })
  })
  it('invents nothing when the store has no hours or timezone', async () => {
    const filled = await withStoreScheduleDefaults(db(null), 't', 'petshop', {})
    expect(filled.petbot_business_hours).toBeUndefined()
    expect(filled.petbot_timezone).toBeUndefined()
  })
})
