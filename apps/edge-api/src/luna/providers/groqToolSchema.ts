type Schema = Readonly<Record<string, unknown>>
const object = (value: unknown): Schema => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Schema : {}
const nullable = (schema: Schema): boolean => schema.type === 'null' || Array.isArray(schema.type) && schema.type.includes('null') || Array.isArray(schema.anyOf) && schema.anyOf.some(value => nullable(object(value)))

// Wire contract only. Optional fields become required nullable values for the
// provider grammar; the authoritative domain schema remains untouched.
export function strictGroqToolSchema(schema: Schema): Schema {
  const converted: Record<string, unknown> = { ...schema }
  if (schema.properties || schema.type === 'object') {
    const properties = object(schema.properties), required = new Set(Array.isArray(schema.required) ? schema.required : [])
    // Groq rejects empty strict function parameter objects. Represent no args
    // with one inert wire-only string enum; it is never an operational input.
    if (Object.keys(properties).length === 0) return {
      ...converted, properties: { _no_arguments: { type:'string',enum:['none'] } },
      required:['_no_arguments'],additionalProperties:false,
    }
    converted.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
      const original = object(value), child = strictGroqToolSchema(original)
      if (required.has(key) || nullable(original)) return [key, child]
      // Prefer the documented nullable type form over an unnecessary anyOf.
      // An optional enum must explicitly include its wire null sentinel.
      if (typeof child.type === 'string') return [key, {
        ...child, type: [child.type, 'null'],
        ...(Array.isArray(child.enum) ? { enum: [...child.enum, null] } : {}),
      }]
      return [key, { anyOf: [child, { type: 'null' }] }]
    }))
    converted.required = Object.keys(properties)
    converted.additionalProperties = false
  }
  if (schema.items) converted.items = strictGroqToolSchema(object(schema.items))
  if (Array.isArray(schema.anyOf)) converted.anyOf = schema.anyOf.map(value => strictGroqToolSchema(object(value)))
  return converted
}

function domainArguments(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value)) return value.map(item => domainArguments(item, object(schema.items)))
  if (value === null || typeof value !== 'object') return value
  const properties = object(schema.properties), required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (schema.type === 'object' && Object.keys(properties).length === 0 && key === '_no_arguments' && child === 'none') return []
    // Remove only the wire sentinel for an originally optional non-null field.
    // Unknown keys and invalid required values survive for server rejection.
    if (Object.hasOwn(properties,key) && child === null && !required.has(key) && !nullable(object(properties[key]))) return []
    return [[key, domainArguments(child, object(properties[key]))]]
  }))
}

export function normalizeGroqToolArguments(raw: string, schema: Schema): string {
  try { return JSON.stringify(domainArguments(JSON.parse(raw), schema)) } catch { return raw }
}
