// Provider error bodies can contain private reasoning and customer data. Only
// finite diagnostic categories and names already present in our request escape.
export function groqDiagnostic(detail: Record<string, unknown>, status: number, toolNames: readonly string[], schemas: readonly Readonly<Record<string,unknown>>[] = []) {
  const knownKeys=new Set(['operationId','expectedVersion','itemId','replacementId'])
  const indexSchema=(schema:Readonly<Record<string,unknown>>,depth=0)=>{
    if(depth>8)return
    const properties=schema.properties
    if(properties&&typeof properties==='object')for(const [key,child]of Object.entries(properties)){knownKeys.add(key);if(child&&typeof child==='object')indexSchema(child,depth+1)}
    if(schema.items&&typeof schema.items==='object')indexSchema(schema.items as Readonly<Record<string,unknown>>,depth+1)
  }
  schemas.forEach(schema=>indexSchema(schema))
  const generatedKeys=new Set<string>()
  const argumentKeys=(value:unknown,depth=0)=>{
    if(depth>8||generatedKeys.size>=40)return
    if(Array.isArray(value)){value.slice(0,4).forEach(child=>argumentKeys(child,depth+1));return}
    if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){generatedKeys.add(knownKeys.has(key)?key:'[unexpected]');argumentKeys(child,depth+1)}
  }
  const field = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(v) && !/^(?:gsk_|sk_|cfut_)/.test(v) ? v : null
  const message = typeof detail.message === 'string' ? detail.message.toLowerCase() : ''
  const categories = [
    ['unsupported_parameter', /not supported|unsupported|unknown field|extra inputs|not permitted/],
    ['invalid_schema', /schema|additionalproperties|required.*properties/],
    ['tool_generation_failed', /tool.*(?:failed|invalid)|failed.*tool/],
    ['context_limit', /context|too many tokens|maximum.*tokens/],
    ['rate_limit', /rate limit|quota/],
  ] as const
  const controls = ['strict','include_reasoning','reasoning_format','reasoning_effort','parallel_tool_calls','max_completion_tokens','tool_choice','additionalproperties','anyof','minlength','maxlength','minimum','maximum','minitems','maxitems','enum','type','required','properties','items']
  const failed = typeof detail.failed_generation === 'string' ? detail.failed_generation : ''
  // Structural category only, never generated text, arguments or reasoning.
  let failedGenerationShape: 'final_json'|'tool_json'|'other_json'|'tool_markup'|'harmony'|'text'|null = null
  if (failed) {
    failedGenerationShape = /<\|(?:start|channel|message|end)/.test(failed) ? 'harmony' : /<\/?(?:tool_call|function)/.test(failed) ? 'tool_markup' : 'text'
    try {
      const value = JSON.parse(failed)
      failedGenerationShape = value && typeof value === 'object' && ('blocks' in value || 'opening' in value) ? 'final_json' : value && typeof value === 'object' && ('tool_calls' in value || 'function' in value || 'name' in value) ? 'tool_json' : 'other_json'
      const calls=Array.isArray(value?.tool_calls)?value.tool_calls:[value]
      for(const call of calls){
        const fn=call?.function??call
        if(!toolNames.includes(fn?.name))continue
        let args=fn.arguments
        if(typeof args==='string'){try{args=JSON.parse(args)}catch{continue}}
        argumentKeys(args)
      }
    } catch { /* keep structural category, not raw generation */ }
  }
  return { status, type: field(detail.type), code: field(detail.code), param: field(detail.param),
    reasons: categories.filter(([, pattern]) => pattern.test(message)).map(([name]) => name),
    controls: controls.filter(name => new RegExp(`\\b${name}\\b`).test(message)),
    generatedToolNames: toolNames.filter(name => failed.includes(name)).slice(0, 10),
    schemaToolNames: /schema/.test(message) ? toolNames.filter(name => message.includes(name)).slice(0,10) : [],
    hasFailedGeneration: Boolean(detail.failed_generation),
    failedGenerationShape,
    generatedArgumentKeys:[...generatedKeys],
  }
}
