import { describe, expect, it } from 'vitest'

import {
  VISUAL_PREVIEW_FIRST_RUN_KEY,
  createVisualPreviewFirstRun,
  readVisualPreviewFirstRun,
  writeVisualPreviewFirstRun,
} from './visualPreviewFirstRun'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('visual preview first run', () => {
  it('starts with a usable Prime IA onboarding draft', () => {
    const draft = createVisualPreviewFirstRun({
      tenantName: 'Pet Shop Demo',
      hours: { 1: { enabled: true, open: '08:00', close: '18:00' } },
    })

    expect(draft.company.business_name).toBe('Pet Shop Demo')
    expect(draft.progress.planSlug).toBe('yui-prime-ia')
    expect(draft.progress.allowedModules).toContain('petbot_ai')
    expect(draft.progress.canComplete).toBe(false)
  })

  it('persists progress locally and tolerates invalid saved data', () => {
    const storage = memoryStorage()
    const draft = createVisualPreviewFirstRun({ tenantName: 'Demo' })
    writeVisualPreviewFirstRun({
      ...draft,
      wizardStep: 3,
      progress: { ...draft.progress, currentStep: 'tour', canComplete: true },
    }, storage)

    expect(readVisualPreviewFirstRun({ tenantName: 'Fallback' }, storage)).toMatchObject({
      wizardStep: 3,
      company: { business_name: 'Demo' },
      progress: { currentStep: 'tour', canComplete: true },
    })

    const invalidStorage = memoryStorage({ [VISUAL_PREVIEW_FIRST_RUN_KEY]: '{invalid' })
    expect(readVisualPreviewFirstRun({ tenantName: 'Fallback' }, invalidStorage).company.business_name).toBe('Fallback')
  })
})

