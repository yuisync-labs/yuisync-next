export const VISUAL_PREVIEW_KEY = '@yuisync_visual_preview'

export function canUseVisualPreview() {
  return import.meta.env.DEV && typeof window !== 'undefined'
}

export function isVisualPreviewSession() {
  if (!canUseVisualPreview()) return false
  try {
    return window.localStorage.getItem(VISUAL_PREVIEW_KEY) === 'active'
  } catch {
    return false
  }
}
