import { describe, expect, it } from 'vitest'

import {
  ProductionCutoverGateError,
  REQUIRED_STAGING_CERTIFICATION_SCHEMA,
  buildProductionCutoverPlan,
} from '../scripts/migration/productionCutoverGate.mjs'

describe('production cutover gate', () => {
  const validInput = () => ({
    certification: {
      schema: 'yuisync-staging-certification/v5',
      status: 'certified',
    },
    explicitAuthorization: 'AUTHORIZE_PRODUCTION_CUTOVER',
    rollbackBookmarkPresent: true,
    productionPreflight: { status: 'pass' },
  })

  it('accepts the current v5 staging certification contract', () => {
    expect(REQUIRED_STAGING_CERTIFICATION_SCHEMA).toBe('yuisync-staging-certification/v5')
    const plan = buildProductionCutoverPlan(validInput())
    expect(plan.executable).toBe(false)
    expect(plan.staging_certification_schema).toBe('yuisync-staging-certification/v5')
  })

  it('rejects stale staging certification contracts', () => {
    const input = validInput()
    input.certification.schema = 'yuisync-staging-certification/v1'
    expect(() => buildProductionCutoverPlan(input)).toThrowError(ProductionCutoverGateError)
    try {
      buildProductionCutoverPlan(input)
    } catch (error) {
      expect(error.code).toBe('STAGING_CERTIFICATION_REQUIRED')
    }
  })

  it('still requires explicit authorization, rollback and production preflight', () => {
    const missingAuthorization = validInput()
    missingAuthorization.explicitAuthorization = 'NO'
    expect(() => buildProductionCutoverPlan(missingAuthorization)).toThrowError('Production cutover is not authorized.')

    const missingRollback = validInput()
    missingRollback.rollbackBookmarkPresent = false
    expect(() => buildProductionCutoverPlan(missingRollback)).toThrowError('Production cutover is not authorized.')

    const failedPreflight = validInput()
    failedPreflight.productionPreflight = { status: 'fail' }
    expect(() => buildProductionCutoverPlan(failedPreflight)).toThrowError('Production cutover is not authorized.')
  })
})
