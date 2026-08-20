#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const files = [
  'test/legacyAcceptance233.test.mjs',
  'test/agendaOperationalInfrastructure.test.mjs',
  'test/agendaAdaptiveCards.test.mjs',
  'test/agendaIntegratedActions.test.mjs',
  'test/agendaServiceCatalogSource.test.mjs',
  'test/agendaServicePagination.test.mjs',
  'test/operationalServicePolicy.test.mjs',
  'test/appointmentServiceWeightBoundaries.test.mjs',
  'test/agendaServiceDurationRecalculation.test.mjs',
  'test/packageClientIdentityAndCheckout.test.mjs',
  'test/packageReservationLifecycle.test.mjs',
  'test/agendaNativePackageServices.test.mjs',
  'test/petshopPlanAppointmentBenefits.test.mjs',
  'test/subscriptionUsageAdmin.test.mjs',
  'test/packageRecurringAgenda.test.mjs',
  'test/packageTodayMigrationRecovery.test.mjs',
  'test/packageRenewalAcceptance.test.mjs',
  'test/completedPackageResponsibleCorrection.test.mjs',
  'test/agendaVisiblePackageAndGrooming.test.mjs',
  'test/agendaTransportCardLayout.test.mjs',
  'test/manualServiceCatalogAndMotodogOutside.test.mjs',
  'test/petshopOperations.test.mjs',
  'test/teamDeliveryAndCommissionSummary.test.mjs',
  'test/agendaCompletionFinancialCheckout.test.mjs',
  'test/cashRegisterPackageAccounting.test.mjs',
  'test/packageBundleCommission.test.mjs',
  'test/teamCommissionHistory.test.mjs',
  'test/commissionThermalPrintSafety.test.mjs',
  'test/commissionPolicyAcceptance.test.mjs',
  'test/teamPendingResponsibleAssignment.test.mjs',
  'test/multiPetPackages.test.mjs',
  'test/clientsPetsExtractors.test.mjs',
  'test/clientRegistrationStatus.test.mjs',
  'test/clientHistoryNativeAndInstructions.test.mjs',
  'test/clientHistoryGroomingMachine.test.mjs',
  'test/clientHistoryLayoutAndPackageCommissionRuntime.test.mjs',
  'test/agendaHistoryPrintAction.test.mjs',
  'test/agendaPrintCleanup.test.mjs',
  'test/printStateSafetyAcceptance.test.mjs',
  'test/clientSearchCompatibility.test.mjs',
  'test/searchSelectorsAcceptance.test.mjs',
  'test/petbotAgent.test.mjs',
  'test/petbotAgentV3.test.mjs',
  'test/petbotFlowMatrix.test.mjs',
  'test/petbotModes.test.mjs',
  'test/serverlessChatIngestionStatic.test.mjs',
  'test/metaContrastAcceptance.test.mjs',
  'test/productionCutoverGate.test.mjs',
  'test/productionEnvironmentBoundary.test.mjs',
  'test/stagingCutoverGates.test.mjs',
  'test/migrationIntakeReadiness.test.mjs',
  'test/rollbackStatePreservationAcceptance.test.mjs',
]

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env,
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

console.log(JSON.stringify({
  status: 'passed',
  inventory: 233,
  required: 232,
  future_non_gate: ['META-07'],
  node_evidence_files: files.length,
}))
