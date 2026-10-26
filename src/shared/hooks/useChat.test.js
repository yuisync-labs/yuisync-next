import { describe, expect, it } from 'vitest'
import { chatDateBounds } from './useChat'

describe('chatDateBounds', () => {
  it('turns local picker days into D1 UTC bounds covering the whole day', () => {
    const { from, to } = chatDateBounds({ from: '2026-10-26', to: '2026-10-26' })
    expect(from).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    expect(from).toBe(new Date('2026-10-26T00:00:00').toISOString().slice(0, 19).replace('T', ' '))
    expect(Date.parse(`${to.replace(' ', 'T')}Z`) - Date.parse(`${from.replace(' ', 'T')}Z`)).toBe(86_399_000)
  })
  it('leaves open ends empty', () => expect(chatDateBounds({ from: '', to: '' })).toEqual({ from: '', to: '' }))
})
