import type {
  IdentityVerificationPort,
  VerifiedIdentity,
} from '../ports/identityVerification'
import type { TenantAuthorizationPort } from '../ports/tenantAuthorization'

export type TenantPrincipalContext = Readonly<{
  tenantId: string
  principalId: string
  identity: VerifiedIdentity
}>

export type TenantPrincipalResolution =
  | Readonly<{
    kind: 'resolved'
    context: TenantPrincipalContext
  }>
  | Readonly<{
    kind: 'unauthenticated'
  }>
  | Readonly<{
    kind: 'forbidden'
  }>

export type ResolveTenantPrincipalDependencies = Readonly<{
  identityVerification: IdentityVerificationPort
  tenantAuthorization: TenantAuthorizationPort
}>

export async function resolveTenantPrincipal(
  accessToken: string,
  tenantId: string,
  dependencies: ResolveTenantPrincipalDependencies,
): Promise<TenantPrincipalResolution> {
  const verification = await dependencies.identityVerification.verifyAccessToken(accessToken)

  if (!verification.authenticated) {
    return { kind: 'unauthenticated' }
  }

  const authorization = await dependencies.tenantAuthorization.authorize({
    authProvider: verification.identity.provider,
    authSubject: verification.identity.subject,
    tenantId,
  })

  if (!authorization.allowed) {
    return { kind: 'forbidden' }
  }

  return {
    kind: 'resolved',
    context: {
      tenantId: authorization.tenantId,
      principalId: authorization.principalId,
      identity: verification.identity,
    },
  }
}
