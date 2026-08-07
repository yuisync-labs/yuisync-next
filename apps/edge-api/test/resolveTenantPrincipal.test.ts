import { describe, expect, it } from 'vitest'

import type { IdentityVerificationPort } from '../../../server/application/ports/identityVerification'
import type {
  TenantAccessRequest,
  TenantAuthorizationPort,
} from '../../../server/application/ports/tenantAuthorization'
import { resolveTenantPrincipal } from '../../../server/application/services/resolveTenantPrincipal'

describe('resolveTenantPrincipal', () => {
  it('não consulta membership quando o token é inválido', async () => {
    let authorizationCalls = 0
    const identityVerification: IdentityVerificationPort = {
      verifyAccessToken: async () => ({
        authenticated: false,
        reason: 'invalid_token',
      }),
    }
    const tenantAuthorization: TenantAuthorizationPort = {
      authorize: async () => {
        authorizationCalls += 1
        throw new Error('should not be called')
      },
    }

    await expect(resolveTenantPrincipal(
      'invalid-token',
      'tenant-a',
      { identityVerification, tenantAuthorization },
    )).resolves.toEqual({ kind: 'unauthenticated' })

    expect(authorizationCalls).toBe(0)
  })

  it('passa somente provider/subject verificados para a autorização de tenant', async () => {
    let authorizationRequest: TenantAccessRequest | null = null
    const identityVerification: IdentityVerificationPort = {
      verifyAccessToken: async () => ({
        authenticated: true,
        identity: {
          provider: 'supabase',
          subject: 'verified-subject',
        },
      }),
    }
    const tenantAuthorization: TenantAuthorizationPort = {
      authorize: async (request) => {
        authorizationRequest = request
        return {
          allowed: true,
          tenantId: request.tenantId,
          principalId: 'principal-1',
        }
      },
    }

    await expect(resolveTenantPrincipal(
      'opaque-token',
      'tenant-a',
      { identityVerification, tenantAuthorization },
    )).resolves.toEqual({
      kind: 'resolved',
      context: {
        tenantId: 'tenant-a',
        principalId: 'principal-1',
        identity: {
          provider: 'supabase',
          subject: 'verified-subject',
        },
      },
    })

    expect(authorizationRequest).toEqual({
      authProvider: 'supabase',
      authSubject: 'verified-subject',
      tenantId: 'tenant-a',
    })
  })

  it('reduz qualquer negação de membership a forbidden na boundary HTTP futura', async () => {
    const identityVerification: IdentityVerificationPort = {
      verifyAccessToken: async () => ({
        authenticated: true,
        identity: {
          provider: 'supabase',
          subject: 'verified-subject',
        },
      }),
    }
    const tenantAuthorization: TenantAuthorizationPort = {
      authorize: async (request) => ({
        allowed: false,
        tenantId: request.tenantId,
        reason: 'membership_not_found',
      }),
    }

    await expect(resolveTenantPrincipal(
      'opaque-token',
      'tenant-other',
      { identityVerification, tenantAuthorization },
    )).resolves.toEqual({ kind: 'forbidden' })
  })

  it('propaga indisponibilidade de identidade em vez de transformá-la em 401', async () => {
    const providerError = new Error('identity dependency unavailable')
    const identityVerification: IdentityVerificationPort = {
      verifyAccessToken: async () => {
        throw providerError
      },
    }
    const tenantAuthorization: TenantAuthorizationPort = {
      authorize: async () => {
        throw new Error('should not be called')
      },
    }

    await expect(resolveTenantPrincipal(
      'opaque-token',
      'tenant-a',
      { identityVerification, tenantAuthorization },
    )).rejects.toBe(providerError)
  })

  it('propaga indisponibilidade da autorização em vez de conceder acesso', async () => {
    const authorizationError = new Error('tenant dependency unavailable')
    const identityVerification: IdentityVerificationPort = {
      verifyAccessToken: async () => ({
        authenticated: true,
        identity: {
          provider: 'supabase',
          subject: 'verified-subject',
        },
      }),
    }
    const tenantAuthorization: TenantAuthorizationPort = {
      authorize: async () => {
        throw authorizationError
      },
    }

    await expect(resolveTenantPrincipal(
      'opaque-token',
      'tenant-a',
      { identityVerification, tenantAuthorization },
    )).rejects.toBe(authorizationError)
  })
})
