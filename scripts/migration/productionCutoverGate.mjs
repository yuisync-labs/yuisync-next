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
      'verify-quality-and-double-staging-certification',
      'provision-isolated-production-resources',
      'snapshot-certified-staging-databases',
      'restore-production-databases',
      'reconcile-production-snapshot',
      'deploy-release-sha-with-domain-detached',
      'run-workers-dev-authenticated-canary',
      'capture-production-time-travel-bookmarks',
      'attach-yuisync-app-custom-domain',
      'run-live-domain-authenticated-canary',
      'retain-rollback-window',
    ],
    stop_conditions: [
      'release-sha-mismatch','certification-count-below-two','snapshot-divergence',
      'tenant-isolation-failure','authenticated-canary-failure','domain-ownership-conflict',
      'rollback-path-unavailable','error-budget-breach',
    ],
  })
}
