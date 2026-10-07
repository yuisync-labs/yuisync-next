import { describe, it, expect } from 'vitest'
import { compactToolSchema } from '../src/luna/providers/compactSchema'
import { strictGroqToolSchema } from '../src/luna/providers/groqToolSchema'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { GroqProvider } from '../src/luna/providers/groqProvider'
import { LUNA_OPERATIONAL_SYSTEM_PROMPT } from '../src/luna/systemPrompt'
import { composeLunaModelMessages } from '../src/luna/runLunaTurn'

describe('Luna compact model context', () => {
  it('removes annotations without changing constraints or a property named description', () => {
    const schema = { type: 'object', description: 'documentation', properties: { description: { type: 'string', description: 'annotation', maxLength: 20 }, count: { type: 'integer', minimum: 1, maximum: 100 }, entries: { type: 'array', maxItems: 8, items: { type: 'string', description: 'annotation', enum: ['x','y'] } } }, required: ['description'], additionalProperties: false }
    expect(compactToolSchema(schema)).toEqual({ type: 'object', properties: { description: { type: 'string', maxLength: 20 }, count: { type: 'integer', minimum: 1, maximum: 100 }, entries: { type: 'array', maxItems: 8, items: { type: 'string', enum: ['x','y'] } } }, required: ['description'], additionalProperties: false })
    expect(schema.description).toBe('documentation')
    expect(schema.properties.description.description).toBe('annotation')
  })

  it('keeps all 22 native tools and strict contracts, while reducing wire size', () => {
    const definitions = createLunaToolRegistry({} as D1Database).definitions
    const provider = new GroqProvider({ apiKey: 'fixture-only', model: 'openai/gpt-oss-20b' })
    const messages = composeLunaModelMessages([{role:'system',content:LUNA_OPERATIONAL_SYSTEM_PROMPT},{role:'user',content:'fixture'}], [])
    const body = JSON.parse(provider.serializeRequest({messages,tools:definitions}))
    expect(body.tools).toHaveLength(22)
    let removedBytes = 0
    for (const [index, definition] of definitions.entries()) {
      const original = strictGroqToolSchema(definition.parameters)
      expect(body.tools[index].function.parameters).toEqual(compactToolSchema(original))
      expect(body.tools[index].function.strict).toBe(true)
      removedBytes += JSON.stringify(original).length - JSON.stringify(body.tools[index].function.parameters).length
    }
    expect(removedBytes).toBeGreaterThan(1000)
    expect(LUNA_OPERATIONAL_SYSTEM_PROMPT.length).toBeLessThan(2200)
    expect(messages[0].content).not.toContain('FATOS CONSULTADOS')
  })
})
