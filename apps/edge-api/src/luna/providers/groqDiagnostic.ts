// Provider error bodies can contain private reasoning and customer data. Only
// finite diagnostic categories and names already present in our request escape.
export function groqDiagnostic(detail: Record<string, unknown>, status: number, toolNames: readonly string[]) {
  const field = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(v) && !/^(?:gsk_|sk_|cfut_)/.test(v) ? v : null
  const message = typeof detail.message === 'string' ? detail.message.toLowerCase() : ''
  const categories = [
    ['unsupported_parameter', /not supported|unsupported|unknown field|extra inputs|not permitted/],
    ['invalid_schema', /schema|additionalproperties|required.*properties/],
    ['tool_generation_failed', /tool.*(?:failed|invalid)|failed.*tool/],
    ['context_limit', /context|too many tokens|maximum.*tokens/],
    ['rate_limit', /rate limit|quota/],
  ] as const
  const controls = ['strict','include_reasoning','reasoning_format','reasoning_effort','parallel_tool_calls','max_completion_tokens','tool_choice','additionalproperties','anyof']
  const failed = typeof detail.failed_generation === 'string' ? detail.failed_generation : ''
  return { status, type: field(detail.type), code: field(detail.code), param: field(detail.param),
    reasons: categories.filter(([, pattern]) => pattern.test(message)).map(([name]) => name),
    controls: controls.filter(name => new RegExp(`\\b${name}\\b`).test(message)),
    generatedToolNames: toolNames.filter(name => failed.includes(name)).slice(0, 10),
    hasFailedGeneration: Boolean(detail.failed_generation),
  }
}
