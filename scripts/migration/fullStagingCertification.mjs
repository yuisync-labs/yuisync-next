export const REQUIRED_CERTIFICATION_CHECKS = Object.freeze([
  'schema_v16','tenant_isolation','clients_pets','catalog_services','inventory','operational_config',
  'appointments','motodog','sales_checkout','payments_splits','chat','operation_state','fiscal_outbox','auth_db',
  'operational_reconciliation','auth_identity_transition','auth_signin','frontend_no_supabase','cloudflare_spa',
  'transient_state_drained','idempotency_rerun','rollback_bookmark','queue_dlq','readiness',
])

export class StagingCertificationError extends Error {
  constructor(code) { super('Staging certification failed.'); this.name='StagingCertificationError'; this.code=code }
}

export function certifyStaging({ environment, checks, runId, certifiedAt }) {
  if (environment !== 'staging') throw new StagingCertificationError('ENVIRONMENT_NOT_STAGING')
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(runId ?? ''))) throw new StagingCertificationError('RUN_ID_INVALID')
  if (!Array.isArray(checks)) throw new StagingCertificationError('CHECKS_INVALID')
  const byName = new Map(checks.map((check) => [check?.name, check]))
  for (const name of REQUIRED_CERTIFICATION_CHECKS) {
    const check = byName.get(name)
    if (!check || check.status !== 'pass') throw new StagingCertificationError(`CHECK_FAILED:${name}`)
  }
  return Object.freeze({
    schema: 'yuisync-staging-certification/v2', environment: 'staging', run_id: runId,
    status: 'certified', certified_at: certifiedAt, checks: REQUIRED_CERTIFICATION_CHECKS,
  })
}
