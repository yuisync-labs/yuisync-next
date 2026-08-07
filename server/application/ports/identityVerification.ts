export type VerifiedIdentity = Readonly<{
  provider: string
  subject: string
}>

export type IdentityVerificationResult =
  | Readonly<{
    authenticated: true
    identity: VerifiedIdentity
  }>
  | Readonly<{
    authenticated: false
    reason: 'invalid_token'
  }>

export interface IdentityVerificationPort {
  verifyAccessToken(accessToken: string): Promise<IdentityVerificationResult>
}
