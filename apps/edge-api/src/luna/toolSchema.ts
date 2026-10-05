// Fail closed on unsupported schema keywords. Model adherence is not authorization.
type Schema = Readonly<Record<string, unknown>>
const supported = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'enum', 'description', 'minLength', 'maxLength'])
export function matchesToolSchema(value: unknown, schema: Schema, depth = 0): boolean {
  if (depth > 12 || Object.keys(schema).some((key) => !supported.has(key))) return false
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (!types.includes(type) && !(types.includes('integer') && typeof value === 'number' && Number.isSafeInteger(value))) return false
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false
  }
  if (typeof value === 'string') {
    if (value.length > (typeof schema.maxLength === 'number' ? schema.maxLength : 4000)) return false
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false
  }
  if (Array.isArray(value)) {
    if (value.length < Number(schema.minItems ?? 0) || value.length > Number(schema.maxItems ?? 100)) return false
    if (!schema.items || typeof schema.items !== 'object') return false
    return value.every((item) => matchesToolSchema(item, schema.items as Schema, depth + 1))
  }
  if (value && typeof value === 'object') {
    const properties = (schema.properties ?? {}) as Record<string, Schema>
    const object = value as Record<string, unknown>
    if (Array.isArray(schema.required) && schema.required.some((key) => typeof key !== 'string' || !Object.hasOwn(object, key))) return false
    return Object.entries(object).every(([key, item]) => Object.hasOwn(properties, key)
      ? matchesToolSchema(item, properties[key], depth + 1) : schema.additionalProperties === true)
  }
  return true
}
