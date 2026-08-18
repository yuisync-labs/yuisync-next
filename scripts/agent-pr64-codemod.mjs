import fs from 'node:fs'

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${label}: target not found in ${path}`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target is not unique in ${path}`)
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

// Existing subscription metadata PATCH must preserve package usage. Usage is changed only by /usage.
replaceOnce(
  'apps/edge-api/src/petshopPlansApi.ts',
  `      UPDATE client_subscriptions
      SET plan_id=?4,client_id=?5,status=?6,started_at_ms=?7,next_billing_date=?8,
          benefit_ledger_base_used_json=?9,cancelled_at_ms=?10,updated_at_ms=?11
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    \`).bind(tenantId, moduleId, id, planId, clientId, status, startedAtMs, nextBillingDate, JSON.stringify(servicesUsed), cancelledAtMs, now).run()`,
  `      UPDATE client_subscriptions
      SET plan_id=?4,client_id=?5,status=?6,started_at_ms=?7,next_billing_date=?8,
          cancelled_at_ms=?9,updated_at_ms=?10
      WHERE tenant_id=?1 AND module_id=?2 AND id=?3
    \`).bind(tenantId, moduleId, id, planId, clientId, status, startedAtMs, nextBillingDate, cancelledAtMs, now).run()`,
  'preserve canonical usage on subscription metadata patch',
)

// Use a valid late-completion fixture: release the existing open reservation before consuming the fourth unit.
const testPath = 'apps/edge-api/test/packageUsageLedgerV29.test.ts'
let testSource = fs.readFileSync(testPath, 'utf8')
const secondTestMarker = "  it('creates the canonical consumed allocation when coverage is marked on a service after appointment completion', async () => {\n    const seeded = await seed()\n    try {\n"
if (!testSource.includes(secondTestMarker)) throw new Error('late consumption test marker not found')
testSource = testSource.replace(secondTestMarker, `${secondTestMarker}      await db.prepare(\`\n        UPDATE subscription_benefit_allocations\n        SET state='released',released_at_ms=?3,updated_at_ms=?3\n        WHERE tenant_id=?1 AND subscription_id=?2 AND state='reserved'\n      \`).bind(seeded.tenantId, seeded.subscriptionId, seeded.now + 100).run()\n\n`)
fs.writeFileSync(testPath, testSource)

// Bridge legacy consumers (notably Clientes & Pets) onto the same canonical native plan API.
const hookPath = 'src/modules/petshop/hooks/usePetshopAdvanced.js'
let hook = fs.readFileSync(hookPath, 'utf8')
const importNeedle = "import { usePetshopAdvanced as usePetshopAdvancedCore } from './usePetshopAdvancedCore'\n"
if (!hook.includes(importNeedle)) throw new Error('advanced hook import marker not found')
hook = hook.replace(importNeedle, `${importNeedle}import { useCatalogPlans } from './useCatalogPlans'\nimport { cancelSubscriptionCommand } from '../lib/planCommands'\n`)

const helperNeedle = "const serviceGroup = (explicitGroup, fallbackSource) => (\n  VALID_SERVICE_GROUPS.has(explicitGroup)\n    ? explicitGroup\n    : inferCatalogServiceGroup(fallbackSource)\n)\n\n"
if (!hook.includes(helperNeedle)) throw new Error('advanced hook helper marker not found')
hook = hook.replace(helperNeedle, `${helperNeedle}const buildCanonicalUsageSummary = (subscription = {}) => (\n  (subscription.subscription_plans?.services || []).map((service) => {\n    const key = service.service_type || service.service_code || service.code\n    const total = Math.max(0, Number(service.qty_per_cycle ?? service.quantity ?? service.qty ?? 0))\n    const used = Math.max(0, Number(subscription.services_used?.[key] || 0))\n    const reserved = Math.max(0, Number(subscription.services_reserved?.[key] || 0))\n    return {\n      service_type: key,\n      used,\n      reserved,\n      total,\n      remaining: Math.max(0, total - used - reserved),\n    }\n  })\n)\n\n`)

const scopeNeedle = "  const moduleId = activeModuleId || 'petshop'\n"
if (!hook.includes(scopeNeedle)) throw new Error('advanced hook scope marker not found')
hook = hook.replace(scopeNeedle, `${scopeNeedle}  const {\n    loadPlans: loadCanonicalPlans,\n    savePlan: saveCanonicalPlan,\n    loadSubscriptions: loadCanonicalSubscriptions,\n    saveSubscription: saveCanonicalSubscription,\n  } = useCatalogPlans()\n`)

const returnNeedle = `  return {
    ...core,
    loadPetshopServices,
    savePetshopService,
  }
}`
if (!hook.includes(returnNeedle)) throw new Error('advanced hook return marker not found')
const returnReplacement = `  const loadClientSubscriptions = useCallback(async () => {
    const rows = await loadCanonicalSubscriptions()
    return (rows || []).map((subscription) => ({
      ...subscription,
      usage_summary: buildCanonicalUsageSummary(subscription),
    }))
  }, [loadCanonicalSubscriptions])

  const saveClientSubscription = useCallback(async (payload = {}) => {
    if (payload?.id && payload?.status === 'cancelled') {
      return cancelSubscriptionCommand({
        tenantId: activeTenantId,
        moduleId,
        subscriptionId: payload.id,
      })
    }
    return saveCanonicalSubscription(payload)
  }, [activeTenantId, moduleId, saveCanonicalSubscription])

  return {
    ...core,
    loadPlans: loadCanonicalPlans,
    savePlan: saveCanonicalPlan,
    loadClientSubscriptions,
    saveClientSubscription,
    loadPetshopServices,
    savePetshopService,
  }
}`
hook = hook.replace(returnNeedle, returnReplacement)
fs.writeFileSync(hookPath, hook)

console.log('PR64 canonical plan bridge codemod applied.')
