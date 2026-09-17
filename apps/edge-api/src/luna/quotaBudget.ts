export class LunaBudgetError extends Error {
  readonly code: 'LUNA_MODEL_CALL_LIMIT' | 'LUNA_TOOL_CALL_LIMIT' | 'LUNA_TOKEN_LIMIT' | 'LUNA_RATE_LIMIT_MARGIN'
  constructor(code: LunaBudgetError['code']) {
    super(code)
    this.name = 'LunaBudgetError'
    this.code = code
  }
}

export function createLunaBudget(options: {
  maxModelCalls?: number
  maxToolCalls?: number
  maxTokens?: number
  minimumRemainingPercent?: number
} = {}) {
  const limits = {
    modelCalls: Math.max(1, Math.min(6, options.maxModelCalls ?? 6)),
    toolCalls: Math.max(1, Math.min(10, options.maxToolCalls ?? 10)),
    tokens: Math.max(1_000, Math.min(32_000, options.maxTokens ?? 12_000)),
    minimumRemainingPercent: Math.max(0, Math.min(50, options.minimumRemainingPercent ?? 20)),
  }
  const usage = { modelCalls: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0 }

  return {
    beforeModel() {
      if (usage.modelCalls >= limits.modelCalls) throw new LunaBudgetError('LUNA_MODEL_CALL_LIMIT')
      usage.modelCalls += 1
    },
    afterModel(input: {
      promptTokens: number
      completionTokens: number
      remainingRequests: number | null
      requestLimit: number | null
      remainingTokens?: number | null
      tokenLimit?: number | null
    }) {
      usage.promptTokens += Math.max(0, input.promptTokens)
      usage.completionTokens += Math.max(0, input.completionTokens)
      if (usage.promptTokens + usage.completionTokens > limits.tokens) throw new LunaBudgetError('LUNA_TOKEN_LIMIT')
      if (input.remainingRequests != null && input.requestLimit != null && input.requestLimit > 0) {
        const remainingPercent = (input.remainingRequests / input.requestLimit) * 100
        if (remainingPercent < limits.minimumRemainingPercent) throw new LunaBudgetError('LUNA_RATE_LIMIT_MARGIN')
      }
      if (input.remainingTokens != null && input.tokenLimit != null && input.tokenLimit > 0) {
        const remainingPercent = (input.remainingTokens / input.tokenLimit) * 100
        if (remainingPercent < limits.minimumRemainingPercent) throw new LunaBudgetError('LUNA_RATE_LIMIT_MARGIN')
      }
    },
    beforeTool() {
      if (usage.toolCalls >= limits.toolCalls) throw new LunaBudgetError('LUNA_TOOL_CALL_LIMIT')
      usage.toolCalls += 1
    },
    snapshot: () => ({ ...usage }),
  }
}
