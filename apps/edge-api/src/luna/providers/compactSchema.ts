// Remove documentation annotations from the wire only. Constraints, property
// names (including a property NAMED description), enums and required lists
// remain byte-for-byte equivalent after annotation removal.
export function compactToolSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...schema }
  delete result.description
  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [name, compactToolSchema(child as Record<string, unknown>)]))
  }
  if (schema.items && typeof schema.items === 'object') result.items = compactToolSchema(schema.items as Record<string, unknown>)
  for (const key of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(schema[key])) result[key] = schema[key].map(child => compactToolSchema(child as Record<string, unknown>))
  return result
}
