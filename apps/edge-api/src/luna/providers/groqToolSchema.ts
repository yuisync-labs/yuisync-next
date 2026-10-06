type Schema = Readonly<Record<string, unknown>>
const object = (value: unknown): Schema => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Schema : {}
const nullable = (schema: Schema): boolean => schema.type === 'null' || Array.isArray(schema.type) && schema.type.includes('null') || Array.isArray(schema.anyOf) && schema.anyOf.some(value => nullable(object(value)))

// Wire contract only. Optional fields become required nullable values for the
// provider grammar; the authoritative domain schema remains untouched.
export function strictGroqToolSchema(schema: Schema): Schema {
  const converted: Record<string, unknown> = { ...schema }
  if (schema.properties || schema.type === 'object') {
    const properties = object(schema.properties), required = new Set(Array.isArray(schema.required) ? schema.required : [])
    converted.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
      const original = object(value), child = strictGroqToolSchema(original)
      return [key, !required.has(key) && !nullable(original) ? { anyOf: [child, { type: 'null' }] } : child]
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
    // Remove only the wire sentinel for an originally optional non-null field.
    // Unknown keys and invalid required values survive for server rejection.
    if (Object.hasOwn(properties,key) && child === null && !required.has(key) && !nullable(object(properties[key]))) return []
    return [[key, domainArguments(child, object(properties[key]))]]
  }))
}

export function normalizeGroqToolArguments(raw: string, schema: Schema): string {
  try { return JSON.stringify(domainArguments(JSON.parse(raw), schema)) } catch { return raw }
}
