import { LunaBudgetError } from './quotaBudget'

type QuotaObservation = { promptTokens: number; tokenLimit: number | null; remainingTokens: number | null; resetTokens: string | null }

export function resetDurationMs(value: string | null): number | null {
  if (!value || value.length > 40 || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return null
  let total = 0
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) total += Number(match[1]) * ({ms:1,s:1000,m:60000,h:3600000}[match[2]] ?? 0)
  return Number.isFinite(total) && total >= 0 ? Math.ceil(total) : null
}

// Successful tool calls are never repeated. Before another inference, respect
// the provider's TPM reset if the last reported balance cannot cover a similar
// prompt, the completion cap and the existing 20% safety margin. Waiting is
// bounded and consumes no model call, tokens or D1 reads; no headers are forged.
export function createLunaQuotaPacer(options: { now?:()=>number; sleep?:(ms:number)=>Promise<void>; maxWaitMs?:number } = {}) {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve,ms)))
  const maxWait = Math.min(120000,Math.max(0,options.maxWaitMs ?? 120000))
  let previous: (QuotaObservation & { at:number }) | null = null, waited = 0
  return {
    observe(value: QuotaObservation, receivedAtMs = now()) { previous = {...value,at:receivedAtMs} },
    async beforeModel() {
      const value = previous
      if (!value || !value.tokenLimit || value.remainingTokens == null) return
      const headroom = value.promptTokens + 256 + 1200 + Math.ceil(value.tokenLimit * 0.2)
      if (headroom > value.tokenLimit) throw new LunaBudgetError('LUNA_RATE_LIMIT_MARGIN')
      if (value.remainingTokens >= headroom) return
      const reset = resetDurationMs(value.resetTokens)
      if (reset == null || reset > 60000) throw new LunaBudgetError('LUNA_RATE_LIMIT_MARGIN')
      const delay = Math.max(0,value.at + reset + 250 - now())
      if (waited + delay > maxWait) throw new LunaBudgetError('LUNA_RATE_LIMIT_MARGIN')
      waited += delay
      await sleep(delay)
      previous = null // Fresh response must provide the next real observation.
    },
  }
}
