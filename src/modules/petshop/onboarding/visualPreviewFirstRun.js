import { PLAN_ENTITLEMENTS } from '../../../config/planEntitlements'

export const VISUAL_PREVIEW_FIRST_RUN_KEY = '@yuisync-preview-first-run-v1'

function cloneHours(hours) {
  return Object.fromEntries(
    Object.entries(hours || {}).map(([day, value]) => [day, { ...value }]),
  )
}

export function createVisualPreviewFirstRun({
  tenantName = 'Ambiente de demonstração',
  hours = {},
  selectedServices = ['banho-tosa'],
} = {}) {
  return {
    version: 1,
    wizardStep: 1,
    company: {
      business_name: tenantName,
      business_tax_id: '',
      logo_url: '',
    },
    hours: cloneHours(hours),
    selectedServices: [...selectedServices],
    progress: {
      status: 'in_progress',
      currentStep: 'empresa',
      completedSteps: [],
      planSlug: 'yui-prime-ia',
      allowedModules: [...PLAN_ENTITLEMENTS['yui-prime-ia'].modules],
      canComplete: false,
    },
  }
}

export function readVisualPreviewFirstRun(defaults, storage = window.localStorage) {
  const fallback = createVisualPreviewFirstRun(defaults)
  try {
    const parsed = JSON.parse(storage.getItem(VISUAL_PREVIEW_FIRST_RUN_KEY) || 'null')
    if (!parsed || parsed.version !== 1) return fallback
    return {
      ...fallback,
      ...parsed,
      company: { ...fallback.company, ...(parsed.company || {}) },
      hours: { ...fallback.hours, ...cloneHours(parsed.hours) },
      selectedServices: Array.isArray(parsed.selectedServices)
        ? parsed.selectedServices
        : fallback.selectedServices,
      progress: { ...fallback.progress, ...(parsed.progress || {}) },
    }
  } catch {
    return fallback
  }
}

export function writeVisualPreviewFirstRun(draft, storage = window.localStorage) {
  storage.setItem(VISUAL_PREVIEW_FIRST_RUN_KEY, JSON.stringify({ ...draft, version: 1 }))
  return draft
}

