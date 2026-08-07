import { describe, expect, it } from 'vitest'

import {
  SupabaseIdentityVerifier,
  SupabaseIdentityVerifierError,
} from '../src/adapters/supabaseIdentityVerifier'

function createFetcher(
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return handler as typeof fetch
}

describe('SupabaseIdentityVerifier', () => {
  it('valida o token no Auth server com publishable key, sem service role', async () => {
    let capturedUrl = ''
    let capturedAuthorization = ''
    let capturedApiKey = ''

    const verifier = new SupabaseIdentityVerifier({
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'publishable-test-key',
      fetcher: createFetcher(async (input, init) => {
        capturedUrl = String(input)
        const headers = new Headers(init?.headers)
        capturedAuthorization = headers.get('authorization') || ''
        capturedApiKey = headers.get('apikey') || ''

        return Response.json({ id: 'user-subject-123' })
      }),
    })

    await expect(verifier.verifyAccessToken('jwt.access.token')).resolves.toEqual({
      authenticated: true,
      identity: {
        provider: 'supabase',
        subject: 'user-subject-123',
      },
    })

    expect(capturedUrl).toBe('https://project-ref.supabase.co/auth/v1/user')
    expect(capturedAuthorization).toBe('Bearer jwt.access.token')
    expect(capturedApiKey).toBe('publishable-test-key')
  })

  it.each([401, 403])('classifica HTTP %s como token inválido', async (status) => {
    const verifier = new SupabaseIdentityVerifier({
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'publishable-test-key',
      fetcher: createFetcher(async () => new Response(null, { status })),
    })

    await expect(verifier.verifyAccessToken('invalid.jwt')).resolves.toEqual({
      authenticated: false,
      reason: 'invalid_token',
    })
  })

  it('rejeita token vazio ou com whitespace sem chamar o provider', async () => {
    let calls = 0
    const verifier = new SupabaseIdentityVerifier({
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'publishable-test-key',
      fetcher: createFetcher(async () => {
        calls += 1
        return Response.json({ id: 'unexpected' })
      }),
    })

    await expect(verifier.verifyAccessToken('   ')).resolves.toEqual({
      authenticated: false,
      reason: 'invalid_token',
    })
    await expect(verifier.verifyAccessToken('abc def')).resolves.toEqual({
      authenticated: false,
      reason: 'invalid_token',
    })
    expect(calls).toBe(0)
  })

  it.each([429, 500, 503])('trata HTTP %s como indisponibilidade do provider', async (status) => {
    const verifier = new SupabaseIdentityVerifier({
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'publishable-test-key',
      fetcher: createFetcher(async () => new Response(null, { status })),
    })

    await expect(verifier.verifyAccessToken('valid-shape-token')).rejects.toMatchObject({
      name: 'SupabaseIdentityVerifierError',
      code: 'IDENTITY_PROVIDER_UNAVAILABLE',
      message: 'Identity verification could not be completed.',
    })
  })

  it('trata falha de rede como dependência indisponível sem vazar token', async () => {
    const token = 'sensitive.jwt.value'
    const verifier = new SupabaseIdentityVerifier({
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'publishable-test-key',
      fetcher: createFetcher(async () => {
        throw new Error(`network failed for ${token}`)
      }),
    })

    let error: unknown
    try {
      await verifier.verifyAccessToken(token)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(SupabaseIdentityVerifierError)
    expect(error).toMatchObject({ code: 'IDENTITY_PROVIDER_UNAVAILABLE' })
    expect(String((error as Error).message)).not.toContain(token)
  })

  it('falha fechado quando o provider responde payload inválido', async () => {
    const verifier = new SupabaseIdentityVerifier({
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'publishable-test-key',
      fetcher: createFetcher(async () => Response.json({ email: 'missing-id@example.test' })),
    })

    await expect(verifier.verifyAccessToken('valid-shape-token')).rejects.toMatchObject({
      code: 'IDENTITY_PROVIDER_PROTOCOL_ERROR',
    })
  })

  it('permite HTTP somente para desenvolvimento local', () => {
    expect(() => new SupabaseIdentityVerifier({
      supabaseUrl: 'http://example.com',
      publishableKey: 'publishable-test-key',
    })).toThrowError(SupabaseIdentityVerifierError)

    expect(() => new SupabaseIdentityVerifier({
      supabaseUrl: 'http://127.0.0.1:54321',
      publishableKey: 'publishable-test-key',
    })).not.toThrow()
  })
})
