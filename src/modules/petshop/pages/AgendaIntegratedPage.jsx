import { useEffect } from 'react'
import AgendaResolvedPage from './AgendaResolvedPage'

const LUNCH_START_MINUTES = 11 * 60
const LUNCH_END_MINUTES = 13 * 60
const LUNCH_COLLAPSED_HEIGHT = 32

const FLUID_AGENDA_STYLES = `
  .yuisync-agenda-card-surface,
  .yuisync-resolved-card {
    min-width: 0 !important;
    padding: 7px !important;
  }

  .yuisync-card-header {
    min-height: 34px !important;
    padding-right: 96px !important;
    gap: 4px !important;
    align-content: flex-start !important;
  }

  .yuisync-card-body {
    min-width: 0 !important;
    gap: 2px !important;
  }

  .yuisync-card-time {
    font-size: 11px !important;
    line-height: 1.05 !important;
    font-weight: 900 !important;
    letter-spacing: 0 !important;
  }

  .yuisync-card-status {
    max-width: 100% !important;
    font-size: 9px !important;
    line-height: 1.1 !important;
    font-weight: 800 !important;
  }

  .yuisync-card-pet,
  .yuisync-card-tutor,
  .yuisync-card-service > span:first-child {
    min-width: 0 !important;
    overflow: hidden !important;
    display: -webkit-box !important;
    -webkit-box-orient: vertical !important;
    overflow-wrap: anywhere !important;
  }

  .yuisync-card-pet {
    margin-top: 1px !important;
    font-size: 12px !important;
    line-height: 1.15 !important;
    font-weight: 900 !important;
    -webkit-line-clamp: 2 !important;
  }

  .yuisync-card-tutor {
    margin-top: 0 !important;
    font-size: 10px !important;
    line-height: 1.2 !important;
    font-weight: 700 !important;
    -webkit-line-clamp: 2 !important;
  }

  .yuisync-card-service {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: start !important;
    gap: 5px !important;
    margin-top: 2px !important;
    min-width: 0 !important;
    font-size: 10px !important;
    line-height: 1.2 !important;
    font-weight: 700 !important;
  }

  .yuisync-card-service > span:first-child {
    -webkit-line-clamp: 2 !important;
  }

  .yuisync-card-service > span:last-child {
    white-space: nowrap !important;
    font-size: 10px !important;
    line-height: 1.2 !important;
    font-weight: 900 !important;
  }

  .yuisync-card-transport,
  .yuisync-card-responsible {
    min-width: 0 !important;
    margin-top: 1px !important;
    font-size: 9px !important;
    line-height: 1.15 !important;
    font-weight: 600 !important;
  }

  .yuisync-card-transport > p {
    min-width: 0 !important;
  }

  .yuisync-card-transport > p:not(:first-child) {
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
  }

  .yuisync-resolved-actions {
    right: 5px !important;
    top: 5px !important;
    gap: 4px !important;
  }

  .yuisync-resolved-action {
    width: 28px !important;
    height: 28px !important;
    flex-basis: 28px !important;
    border-radius: 8px !important;
  }

  [data-yuisync-density='compact'],
  [data-yuisync-density='dense'],
  [data-yuisync-density='micro'] {
    padding: 5px !important;
  }

  [data-yuisync-density='compact'] .yuisync-card-status,
  [data-yuisync-density='compact'] .yuisync-card-responsible,
  [data-yuisync-density='dense'] .yuisync-card-status,
  [data-yuisync-density='dense'] .yuisync-card-responsible,
  [data-yuisync-density='micro'] .yuisync-card-status,
  [data-yuisync-density='micro'] .yuisync-card-responsible {
    display: none !important;
  }

  [data-yuisync-density='compact'] .yuisync-card-pet,
  [data-yuisync-density='compact'] .yuisync-card-tutor,
  [data-yuisync-density='compact'] .yuisync-card-service > span:first-child {
    -webkit-line-clamp: 2 !important;
  }

  [data-yuisync-density='dense'] .yuisync-card-header,
  [data-yuisync-density='micro'] .yuisync-card-header {
    min-height: 28px !important;
    padding-right: 82px !important;
  }

  [data-yuisync-density='dense'] .yuisync-resolved-action,
  [data-yuisync-density='micro'] .yuisync-resolved-action {
    width: 24px !important;
    height: 24px !important;
    flex-basis: 24px !important;
    border-radius: 7px !important;
  }

  [data-yuisync-density='dense'] .yuisync-card-time,
  [data-yuisync-density='micro'] .yuisync-card-time {
    font-size: 10px !important;
  }

  [data-yuisync-density='dense'] .yuisync-card-pet {
    font-size: 11px !important;
  }

  [data-yuisync-density='dense'] .yuisync-card-tutor,
  [data-yuisync-density='dense'] .yuisync-card-service,
  [data-yuisync-density='dense'] .yuisync-card-service > span:last-child {
    font-size: 9px !important;
  }

  [data-yuisync-density='micro'] .yuisync-card-pet {
    font-size: 10px !important;
  }

  [data-yuisync-density='micro'] .yuisync-card-tutor,
  [data-yuisync-density='micro'] .yuisync-card-service,
  [data-yuisync-density='micro'] .yuisync-card-service > span:last-child,
  [data-yuisync-density='micro'] .yuisync-card-transport {
    font-size: 8.5px !important;
  }

  [data-yuisync-density='dense'] .yuisync-card-pet,
  [data-yuisync-density='dense'] .yuisync-card-tutor,
  [data-yuisync-density='dense'] .yuisync-card-service > span:first-child,
  [data-yuisync-density='micro'] .yuisync-card-pet,
  [data-yuisync-density='micro'] .yuisync-card-tutor,
  [data-yuisync-density='micro'] .yuisync-card-service > span:first-child {
    -webkit-line-clamp: 1 !important;
  }

  [data-yuisync-density='compact'][data-yuisync-motodog='false'] .yuisync-card-transport,
  [data-yuisync-density='dense'][data-yuisync-motodog='false'] .yuisync-card-transport,
  [data-yuisync-density='micro'][data-yuisync-motodog='false'] .yuisync-card-transport {
    display: none !important;
  }

  [data-yuisync-density='compact'] .yuisync-card-transport > p:not(:first-child),
  [data-yuisync-density='dense'] .yuisync-card-transport > p:not(:first-child),
  [data-yuisync-density='micro'] .yuisync-card-transport > p:not(:first-child) {
    display: none !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='grooming'],
  .yuisync-resolved-card[data-yuisync-card-kind='grooming'] {
    border-color: rgba(147, 197, 253, 0.92) !important;
    background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 58%, #172554 100%) !important;
    box-shadow: 0 10px 28px rgba(23, 37, 84, 0.42) !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='bath'],
  .yuisync-resolved-card[data-yuisync-card-kind='bath'] {
    border-color: rgba(110, 231, 183, 0.92) !important;
    background: linear-gradient(135deg, #065f46 0%, #047857 58%, #064e3b 100%) !important;
    box-shadow: 0 10px 28px rgba(6, 78, 59, 0.4) !important;
  }

  [data-yuisync-card-kind='bath'] .yuisync-resolved-action {
    border-color: rgba(167, 243, 208, 0.72) !important;
    background: rgba(6, 95, 70, 0.97) !important;
  }

  [data-yuisync-card-kind='grooming'] .yuisync-resolved-action {
    border-color: rgba(191, 219, 254, 0.72) !important;
    background: rgba(30, 58, 138, 0.97) !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'],
  .yuisync-resolved-card[data-yuisync-card-kind='package'] {
    border-color: rgba(253, 224, 71, 0.95) !important;
    background: linear-gradient(135deg, #92400e 0%, #b45309 54%, #713f12 100%) !important;
    box-shadow: 0 10px 28px rgba(120, 53, 15, 0.42) !important;
  }

  [data-yuisync-card-kind='package'] .yuisync-resolved-action {
    border-color: rgba(254, 240, 138, 0.72) !important;
    background: rgba(146, 64, 14, 0.96) !important;
  }

  [data-yuisync-card-kind='bath'] .yuisync-resolved-action.is-complete,
  [data-yuisync-card-kind='grooming'] .yuisync-resolved-action.is-complete,
  [data-yuisync-card-kind='package'] .yuisync-resolved-action.is-complete {
    background: #059669 !important;
  }

  .yuisync-package-label {
    color: #fef3c7 !important;
    font-size: 9px !important;
    font-weight: 900 !important;
    letter-spacing: .02em !important;
    text-transform: uppercase !important;
    white-space: nowrap !important;
  }

  .yuisync-lunch-toggle {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(251, 191, 36, .35);
    border-radius: 9px;
    background: rgba(245, 158, 11, .1);
    padding: 5px 10px;
    color: #fcd34d;
    font-size: 10px;
    line-height: 1.1;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .yuisync-lunch-marker {
    position: absolute;
    z-index: 24;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-top: 1px dashed rgba(251, 191, 36, .45);
    border-bottom: 1px dashed rgba(251, 191, 36, .45);
    background: rgba(120, 53, 15, .18);
    color: #fcd34d;
    font-size: 10px;
    line-height: 1;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .yuisync-lunch-marker-content,
  .yuisync-lunch-marker-label {
    inset-inline: 0;
  }

  .yuisync-lunch-marker-content {
    cursor: pointer;
  }
`

const normalizeCardText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

const minutesFromClock = (value = '') => {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

const intervalFromCard = (card) => {
  const text = card?.querySelector?.('.yuisync-card-time')?.textContent || ''
  const matches = [...String(text).matchAll(/(\d{1,2}):(\d{2})/g)]
  if (matches.length < 2) return null
  return {
    start: Number(matches[0][1]) * 60 + Number(matches[0][2]),
    end: Number(matches[1][1]) * 60 + Number(matches[1][2]),
  }
}

const inferOverlapCount = (card) => {
  const explicit = Number(card?.dataset?.yuisyncOverlapCount || 0)
  if (explicit > 0) return explicit
  const width = card?.getBoundingClientRect?.().width || 0
  if (width <= 150) return 5
  if (width <= 205) return 4
  if (width <= 320) return 3
  return 2
}

const applyCardPresentation = () => {
  document.querySelectorAll('.yuisync-agenda-card-surface').forEach((card) => {
    const text = normalizeCardText(card.textContent)
    card.dataset.yuisyncMotodog = String(/motodog|buscar e trazer|buscar|trazer/.test(text))

    const count = inferOverlapCount(card)
    card.dataset.yuisyncDensity = count <= 2
      ? 'comfortable'
      : count === 3
        ? 'compact'
        : count === 4
          ? 'dense'
          : 'micro'
  })
}

function AgendaFluidRefinement() {
  useEffect(() => {
    let frame = 0
    let lunchPreference = null
    const managedStyles = new WeakMap()

    const rememberAndApply = (element, property, value) => {
      if (!element) return
      const state = managedStyles.get(element) || {}
      state[property] = { original: element.style[property], applied: value }
      managedStyles.set(element, state)
      element.style[property] = value
    }

    const restoreManaged = (element) => {
      const state = managedStyles.get(element)
      if (!state) return
      Object.entries(state).forEach(([property, values]) => {
        if (element.style[property] === values.applied) element.style[property] = values.original
      })
      managedStyles.delete(element)
    }

    const resetLunchColumn = (column) => {
      if (!column) return
      restoreManaged(column)
      ;[...column.children].forEach((node) => {
        if (node.dataset.yuisyncLunchMarker) return
        restoreManaged(node)
      })
    }

    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(applyAll)
    }

    const ensureMarker = (column, kind, top) => {
      const selector = `[data-yuisync-lunch-marker='${kind}']`
      let marker = column.querySelector(selector)
      if (!marker) {
        marker = document.createElement(kind === 'content' ? 'button' : 'div')
        if (kind === 'content') marker.type = 'button'
        marker.dataset.yuisyncLunchMarker = kind
        marker.className = `yuisync-lunch-marker ${kind === 'content' ? 'yuisync-lunch-marker-content' : 'yuisync-lunch-marker-label'}`
        marker.textContent = kind === 'content' ? '11:00–13:00 recolhido · clique para abrir' : '11–13'
        column.appendChild(marker)
      }
      marker.style.top = `${top}px`
      marker.style.height = `${LUNCH_COLLAPSED_HEIGHT}px`
      marker.style.display = 'flex'
      if (kind === 'content') {
        marker.onclick = () => {
          lunchPreference = 'expanded'
          schedule()
        }
      }
    }

    const applyLunchGap = () => {
      const allSlots = [...document.querySelectorAll('button[aria-label^="Agendar as "]')]
      const initialStart = allSlots.find((slot) => minutesFromClock(slot.getAttribute('aria-label')) === LUNCH_START_MINUTES)
      const initialEnd = allSlots.find((slot) => minutesFromClock(slot.getAttribute('aria-label')) === LUNCH_END_MINUTES)
      if (!initialStart || !initialEnd || initialStart.parentElement !== initialEnd.parentElement) return

      const contentColumn = initialStart.parentElement
      const labelColumn = contentColumn.previousElementSibling
      const grid = contentColumn.parentElement
      if (!labelColumn || !grid) return

      resetLunchColumn(labelColumn)
      resetLunchColumn(contentColumn)

      const slots = [...contentColumn.querySelectorAll('button[aria-label^="Agendar as "]')]
      const startSlot = slots.find((slot) => minutesFromClock(slot.getAttribute('aria-label')) === LUNCH_START_MINUTES)
      const endSlot = slots.find((slot) => minutesFromClock(slot.getAttribute('aria-label')) === LUNCH_END_MINUTES)
      if (!startSlot || !endSlot) return

      const startTop = Number(startSlot.style.top.replace('px', ''))
      const endTop = Number(endSlot.style.top.replace('px', ''))
      if (!Number.isFinite(startTop) || !Number.isFinite(endTop) || endTop <= startTop) return

      const lunchInUse = [...contentColumn.querySelectorAll('.yuisync-agenda-card-surface')].some((card) => {
        const interval = intervalFromCard(card)
        return interval && interval.start < LUNCH_END_MINUTES && interval.end > LUNCH_START_MINUTES
      })
      const collapsed = !lunchInUse && lunchPreference !== 'expanded'
      const shift = Math.max(0, (endTop - startTop) - LUNCH_COLLAPSED_HEIGHT)

      const header = grid.parentElement?.previousElementSibling
      let toggle = header?.querySelector?.('[data-yuisync-lunch-toggle]')
      if (header && !toggle) {
        toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.dataset.yuisyncLunchToggle = 'true'
        toggle.className = 'yuisync-lunch-toggle'
        ;(header.lastElementChild || header).appendChild(toggle)
      }
      if (toggle) {
        toggle.disabled = lunchInUse
        toggle.textContent = lunchInUse
          ? '11:00–13:00 em uso'
          : collapsed ? 'Mostrar 11:00–13:00' : 'Recolher 11:00–13:00'
        toggle.onclick = () => {
          if (lunchInUse) return
          lunchPreference = collapsed ? 'expanded' : 'collapsed'
          schedule()
        }
      }

      if (!collapsed) {
        labelColumn.querySelector('[data-yuisync-lunch-marker="label"]')?.remove()
        contentColumn.querySelector('[data-yuisync-lunch-marker="content"]')?.remove()
        grid.dataset.yuisyncLunchCollapsed = 'false'
        return
      }

      ;[labelColumn, contentColumn].forEach((column) => {
        const originalHeight = Number(column.style.height.replace('px', ''))
        if (Number.isFinite(originalHeight)) {
          rememberAndApply(column, 'height', `${Math.max(LUNCH_COLLAPSED_HEIGHT, originalHeight - shift)}px`)
        }

        ;[...column.children].forEach((node) => {
          if (node.dataset.yuisyncLunchMarker || !node.style?.top) return
          const originalTop = Number(node.style.top.replace('px', ''))
          if (!Number.isFinite(originalTop)) return
          if (originalTop >= startTop && originalTop < endTop) {
            rememberAndApply(node, 'display', 'none')
          } else if (originalTop >= endTop) {
            rememberAndApply(node, 'top', `${originalTop - shift}px`)
          }
        })
      })

      ensureMarker(labelColumn, 'label', startTop)
      ensureMarker(contentColumn, 'content', startTop)
      grid.dataset.yuisyncLunchCollapsed = 'true'
    }

    function applyAll() {
      frame = 0
      applyCardPresentation()
      applyLunchGap()
    }

    const onClickCapture = (event) => {
      const selectedService = event.target.closest?.('[role="listbox"][aria-label="Servicos encontrados"] [role="option"]')
      if (!selectedService) return
      window.setTimeout(() => {
        document.querySelector('input[aria-label="Buscar servico para adicionar"]')?.blur()
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      }, 0)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', onClickCapture, true)
    window.addEventListener('resize', schedule)
    schedule()

    return () => {
      observer.disconnect()
      document.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
      document.querySelectorAll('[data-yuisync-lunch-toggle]').forEach((node) => node.remove())
      document.querySelectorAll('[data-yuisync-lunch-marker]').forEach((node) => node.remove())
      document.querySelectorAll('button[aria-label^="Agendar as "]').forEach((slot) => restoreManaged(slot))
    }
  }, [])

  return <style>{FLUID_AGENDA_STYLES}</style>
}

export default function AgendaIntegratedPage({ setPage }) {
  return (
    <>
      <AgendaResolvedPage setPage={setPage} />
      <AgendaFluidRefinement />
    </>
  )
}
