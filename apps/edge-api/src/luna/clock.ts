import type { LunaExecutionContext } from './contracts'

// Trusted execution context only; tool arguments cannot set this clock. Never
// override production time or mutate the global clock across concurrent turns.
export function lunaNow(context: LunaExecutionContext): number {
  if (context.executionMode === 'production' || context.nowMs === undefined) return Date.now()
  if (!Number.isSafeInteger(context.nowMs) || context.nowMs < 0) throw new Error('LUNA_CLOCK_INVALID')
  return context.nowMs
}
