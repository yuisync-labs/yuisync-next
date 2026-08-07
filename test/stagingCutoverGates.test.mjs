import { describe, expect, it } from 'vitest'
import { REQUIRED_CERTIFICATION_CHECKS, certifyStaging } from '../scripts/migration/fullStagingCertification.mjs'
import { buildProductionCutoverPlan } from '../scripts/migration/productionCutoverGate.mjs'

const passingChecks = () => REQUIRED_CERTIFICATION_CHECKS.map((name) => ({ name, status: 'pass' }))

describe('staging certification gate', () => {
  it('certifica somente staging com todos os checks verdes', () => {
    expect(certifyStaging({ environment:'staging', runId:'run_20260807', certifiedAt:'2026-08-07T19:00:00Z', checks:passingChecks() })).toMatchObject({ status:'certified', environment:'staging' })
  })
  it('falha se qualquer domínio não passou', () => {
    const checks=passingChecks().filter((c)=>c.name!=='inventory')
    expect(()=>certifyStaging({ environment:'staging', runId:'run_20260807', certifiedAt:'x', checks })).toThrowError(expect.objectContaining({code:'CHECK_FAILED:inventory'}))
  })
  it('nunca aceita production como ambiente de certificação', () => {
    expect(()=>certifyStaging({ environment:'production', runId:'run_20260807', certifiedAt:'x', checks:passingChecks() })).toThrowError(expect.objectContaining({code:'ENVIRONMENT_NOT_STAGING'}))
  })
})

describe('production cutover gate', () => {
  const certification={schema:'yuisync-staging-certification/v1',status:'certified'}
  it('exige autorização explícita, bookmark e preflight', () => {
    expect(()=>buildProductionCutoverPlan({certification,explicitAuthorization:'',rollbackBookmarkPresent:true,productionPreflight:{status:'pass'}})).toThrowError(expect.objectContaining({code:'EXPLICIT_AUTHORIZATION_REQUIRED'}))
    expect(()=>buildProductionCutoverPlan({certification,explicitAuthorization:'AUTHORIZE_PRODUCTION_CUTOVER',rollbackBookmarkPresent:false,productionPreflight:{status:'pass'}})).toThrowError(expect.objectContaining({code:'ROLLBACK_BOOKMARK_REQUIRED'}))
  })
  it('gera plano não executável quando todos os gates passam', () => {
    const plan=buildProductionCutoverPlan({certification,explicitAuthorization:'AUTHORIZE_PRODUCTION_CUTOVER',rollbackBookmarkPresent:true,productionPreflight:{status:'pass'}})
    expect(plan.executable).toBe(false)
    expect(plan.stop_conditions).toContain('tenant-isolation-failure')
    expect(plan.stop_conditions).toContain('duplicate-financial-or-fiscal-effect')
  })
})