// The customer says only the CEP; the street, neighborhood and city come from
// ViaCEP so the registration is complete without asking for them.
export type PostalAddress = { street: string | null; neighborhood: string | null; city: string | null }
const cache = new Map<string, PostalAddress | 'not_found'>()

export async function lookupPostalCode(cep: string, fetcher: typeof fetch = fetch): Promise<PostalAddress | 'not_found' | null> {
  if (!/^\d{8}$/.test(cep)) return 'not_found'
  const hit = cache.get(cep)
  if (hit) return hit
  try {
    const response = await fetcher(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return response.status === 400 ? 'not_found' : null
    const data = await response.json() as Record<string, unknown>
    const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null
    const found: PostalAddress | 'not_found' = data.erro ? 'not_found' : { street: text(data.logradouro), neighborhood: text(data.bairro), city: text(data.localidade) }
    cache.set(cep, found)
    return found
  } catch {
    // ViaCEP down: register with what the customer said.
    return null
  }
}

// Fills what the customer did not say; a CEP that does not exist is asked again.
export async function withPostalAddress(input: Record<string, unknown>, fetcher?: typeof fetch) {
  const found = typeof input.postal_code === 'string' ? await lookupPostalCode(input.postal_code, fetcher) : null
  if (found === 'not_found') return { notFound: true as const, input }
  if (!found) return { notFound: false as const, input }
  return { notFound: false as const, input: { ...input, street: input.street || found.street, neighborhood: input.neighborhood || found.neighborhood, city: input.city || found.city } }
}
