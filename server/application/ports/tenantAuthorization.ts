export type TenantAccessRequest = Readonly<{
  authProvider: string
  authSubject: string
  tenantId: string
}>

export type TenantAccessDeniedReason =
  | 'tenant_not_found'
  | 'tenant_inactive'
  | 'identity_not_found'
  | 'identity_inactive'
  | 'membership_not_found'
  | 'membership_inactive'

export type TenantAccessDecision =
  | Readonly<{
    allowed: true
    tenantId: string
    principalId: string
  }>
  | Readonly<{
    allowed: false
    tenantId: string
    reason: TenantAccessDeniedReason
  }>

export interface TenantAuthorizationPort {
  authorize(request: TenantAccessRequest): Promise<TenantAccessDecision>
}
