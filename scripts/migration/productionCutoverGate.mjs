export class ProductionCutoverGateError extends Error {
  constructor(code) { super('Production cutover is not authorized.'); this.name='ProductionCutoverGateError'; this.code=code }
}

export const REQUIRED_STAGING_CERTIFICATION_SCHEMA = 'yuisync-staging-certification/v5'

export function buildProductionCutoverPlan({ certification, explicitAuthorization, rollbackBookmarkPresent, productionPreflight }) {
  if (certification?.schema !== REQUIRED_STAGING_CERTIFICATION_SCHEMA || certification?.status !== 'certified') {
    throw new ProductionCutoverGateError('STAGING_CERTIFICATION_REQUIRED')
  }
  if (explicitAuthorization !== 'AUTHORIZE_PRODUCTION_CUTOVER') {
    throw new ProductionCutoverGateError('EXPLICIT_AUTHORIZATION_REQUIRED')
  }
  if (rollbackBookmarkPresent !== true) throw new ProductionCutoverGateError('ROLLBACK_BOOKMARK_REQUIRED')
  if (productionPreflight?.status !== 'pass') throw new ProductionCutoverGateError('PRODUCTION_PREFLIGHT_REQUIRED')

  return Object.freeze({
    schema: 'yuisync-production-cutover-plan/v1',
    executable: true,
    staging_certification_schema: REQUIRED_STAGING_CERTIFICATION_SCHEMA,
    authorization: 'explicit',
    steps: [
      'capture-final-source-checksums','freeze-legacy-writes','capture-production-time-travel-bookmark',
      'apply-domain-migrations','reconcile-all-domain-checksums','enable-internal-canary','enable-test-tenant',
      'increase-traffic-gradually','observe-slo-and-duplicate-effects','finalize-cutover','retain-rollback-window',
    ],
    stop_conditions: [
      'checksum-divergence','tenant-isolation-failure','duplicate-financial-or-fiscal-effect',
      'error-budget-breach','rollback-path-unavailable',
    ],
  })
}
