import test from 'node:test'
import assert from 'node:assert/strict'
import { access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(new URL('../', import.meta.url).pathname)

const GROUPS = [
  ['AG', 18],
  ['SRV', 10],
  ['PESO', 9],
  ['DUR', 6],
  ['PKG', 8],
  ['PKG-S', 7],
  ['LEDGER', 12],
  ['REC', 12],
  ['REN', 7],
  ['EDIT', 10],
  ['CARD', 8],
  ['MOTO', 12],
  ['FIN', 15],
  ['COM', 16],
  ['EQ', 7],
  ['PET', 12],
  ['HIST', 10],
  ['IMP', 12],
  ['SEARCH', 9],
  ['BOT', 14],
  ['META', 7],
  ['INF', 12],
]

const EVIDENCE = {
  AG: [
    'test/agendaOperationalInfrastructure.test.mjs',
    'test/agendaAdaptiveCards.test.mjs',
    'test/agendaIntegratedActions.test.mjs',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  SRV: [
    'test/agendaServiceCatalogSource.test.mjs',
    'test/agendaServicePagination.test.mjs',
    'test/operationalServicePolicy.test.mjs',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  PESO: [
    'src/modules/petshop/lib/serviceWeightBoundaries.test.js',
    'test/appointmentServiceWeightBoundaries.test.mjs',
    'test/operationalServicePolicy.test.mjs',
    'apps/edge-api/test/appointmentCommandIntegration.test.ts',
  ],
  DUR: [
    'test/agendaServiceDurationRecalculation.test.mjs',
    'test/operationalServicePolicy.test.mjs',
    'apps/edge-api/test/appointmentCommandIntegration.test.ts',
  ],
  PKG: [
    'test/packageClientIdentityAndCheckout.test.mjs',
    'test/packageReservationLifecycle.test.mjs',
    'apps/edge-api/test/packageCycleIntegration.test.ts',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  'PKG-S': [
    'test/agendaNativePackageServices.test.mjs',
    'test/petshopPlanAppointmentBenefits.test.mjs',
    'test/packageReservationLifecycle.test.mjs',
    'apps/edge-api/test/packageCycleIntegration.test.ts',
  ],
  LEDGER: [
    'test/packageReservationLifecycle.test.mjs',
    'test/subscriptionUsageAdmin.test.mjs',
    'apps/edge-api/test/packageReconciliationIntegration.test.ts',
    'apps/edge-api/test/packageUsageLedgerV29.test.ts',
    'apps/edge-api/test/appointmentReopenIntegration.test.ts',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  REC: [
    'test/packageRecurringAgenda.test.mjs',
    'test/packageTodayMigrationRecovery.test.mjs',
    'apps/edge-api/test/packageCycleIntegration.test.ts',
  ],
  REN: [
    'test/packageRenewalAcceptance.test.mjs',
    'apps/edge-api/test/packageCycleIntegration.test.ts',
  ],
  EDIT: [
    'apps/edge-api/test/appointmentReopenIntegration.test.ts',
    'apps/edge-api/test/appointmentFinancialReopenIntegration.test.ts',
    'test/completedPackageResponsibleCorrection.test.mjs',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  CARD: [
    'test/agendaAdaptiveCards.test.mjs',
    'test/agendaVisiblePackageAndGrooming.test.mjs',
    'test/agendaTransportCardLayout.test.mjs',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  MOTO: [
    'test/manualServiceCatalogAndMotodogOutside.test.mjs',
    'test/petshopOperations.test.mjs',
    'test/teamDeliveryAndCommissionSummary.test.mjs',
    'apps/edge-api/test/packageCycleIntegration.test.ts',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  FIN: [
    'test/agendaCompletionFinancialCheckout.test.mjs',
    'test/cashRegisterPackageAccounting.test.mjs',
    'apps/edge-api/test/checkoutD1Integration.test.ts',
    'apps/edge-api/test/appointmentFinancialReopenIntegration.test.ts',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  COM: [
    'test/packageBundleCommission.test.mjs',
    'test/teamDeliveryAndCommissionSummary.test.mjs',
    'test/teamCommissionHistory.test.mjs',
    'test/commissionThermalPrintSafety.test.mjs',
  ],
  EQ: [
    'test/teamDeliveryAndCommissionSummary.test.mjs',
    'test/teamPendingResponsibleAssignment.test.mjs',
    'test/completedPackageResponsibleCorrection.test.mjs',
    'test/teamCommissionHistory.test.mjs',
  ],
  PET: [
    'test/multiPetPackages.test.mjs',
    'test/clientsPetsExtractors.test.mjs',
    'test/clientRegistrationStatus.test.mjs',
    'apps/edge-api/test/packageCycleIntegration.test.ts',
    'test/e2e/legacy-regression-p0.spec.js',
  ],
  HIST: [
    'test/clientHistoryNativeAndInstructions.test.mjs',
    'test/clientHistoryGroomingMachine.test.mjs',
    'test/clientHistoryLayoutAndPackageCommissionRuntime.test.mjs',
    'test/agendaHistoryPrintAction.test.mjs',
  ],
  IMP: [
    'test/agendaPrintCleanup.test.mjs',
    'test/agendaHistoryPrintAction.test.mjs',
    'test/commissionThermalPrintSafety.test.mjs',
    'test/printStateSafetyAcceptance.test.mjs',
  ],
  SEARCH: [
    'test/clientSearchCompatibility.test.mjs',
    'test/searchSelectorsAcceptance.test.mjs',
  ],
  BOT: [
    'test/petbotAgent.test.mjs',
    'test/petbotAgentV3.test.mjs',
    'test/petbotFlowMatrix.test.mjs',
    'test/petbotModes.test.mjs',
    'test/serverlessChatIngestionStatic.test.mjs',
    'apps/edge-api/test/coordinationStateMachine.test.ts',
    'apps/edge-api/test/coordinationDurableObject.test.ts',
    'apps/edge-api/test/realtimeApi.test.ts',
  ],
  META: [
    'apps/edge-api/test/d1EncryptedWhatsAppCredentialVault.test.ts',
    'apps/edge-api/test/d1WhatsAppConnectionRepository.test.ts',
    'apps/edge-api/test/metaWhatsAppGraphAdapter.test.ts',
    'apps/edge-api/test/metaWhatsAppOnboardingAdapter.test.ts',
    'apps/edge-api/test/metaWhatsAppTemplateManagementAdapter.test.ts',
    'apps/edge-api/test/whatsappApi.test.ts',
    'apps/edge-api/test/whatsappOutboundLifecycle.test.ts',
    'test/metaContrastAcceptance.test.mjs',
  ],
  INF: [
    'test/productionCloudflare.test.js',
    'test/productionCutoverGate.test.mjs',
    'test/productionEnvironmentBoundary.test.mjs',
    'test/productionRollback.test.js',
    'test/stagingCutoverGates.test.mjs',
    'test/migrationIntakeReadiness.test.mjs',
    'test/migrationManifest.test.js',
    'test/rollbackStatePreservationAcceptance.test.mjs',
    'apps/edge-api/test/d1MigrationUpgradeMatrix.test.ts',
    'apps/edge-api/test/health.test.ts',
    'apps/edge-api/test/d1TenantAuthorization.test.ts',
    'apps/edge-api/test/operationalIntegrityV25.test.ts',
  ],
}

const FUTURE_NON_GATE = new Map([
  ['META-07', 'Coexistência/histórico Meta é explicitamente futuro no documento; se implementado, deverá ganhar gate próprio antes de alimentar a Luna.'],
])

function idsFor(group, count) {
  const separator = group === 'PKG-S' ? '' : '-'
  return Array.from({ length: count }, (_, index) => `${group}${separator}${String(index + 1).padStart(2, '0')}`)
}

const ALL_CASES = GROUPS.flatMap(([group, count]) => idsFor(group, count))
const REQUIRED_CASES = ALL_CASES.filter((id) => !FUTURE_NON_GATE.has(id))

function groupFor(id) {
  if (id.startsWith('PKG-S')) return 'PKG-S'
  return id.split('-')[0]
}

test('legacy acceptance inventory has exactly 233 unique document IDs', () => {
  assert.equal(ALL_CASES.length, 233)
  assert.equal(new Set(ALL_CASES).size, 233)
  assert.equal(REQUIRED_CASES.length, 232)
  assert.deepEqual(ALL_CASES.slice(0, 3), ['AG-01', 'AG-02', 'AG-03'])
  assert.ok(ALL_CASES.includes('PKG-S07'))
  assert.equal(ALL_CASES.at(-1), 'INF-12')
})

for (const id of ALL_CASES) {
  test(`${id} has executable regression evidence`, async () => {
    if (FUTURE_NON_GATE.has(id)) {
      assert.match(FUTURE_NON_GATE.get(id), /futuro/i)
      return
    }
    const evidence = EVIDENCE[groupFor(id)] || []
    assert.ok(evidence.length > 0, `${id} has no evidence suite`)
    assert.ok(evidence.some((path) => /(?:\.test\.|\/e2e\/)/.test(path)), `${id} is not backed by an executable test`)
    for (const path of evidence) {
      const target = resolve(ROOT, path)
      await access(target)
      const info = await stat(target)
      assert.ok(info.isFile(), `${id} evidence is not a file: ${path}`)
    }
  })
}
