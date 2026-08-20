import { useEffect } from 'react'

/**
 * Transitional semantic bridge for the legacy resolved Agenda layer.
 *
 * The resolved layer historically inferred "Diaria" from an amber Tailwind
 * class on the period button. That made operational actions disappear when the
 * theme moved to the primary (green) token. Until the resolved layer is folded
 * into the declarative Agenda state, expose the actual period using the stable
 * daily-grid structure instead of visual styling.
 */
export default function AgendaDailyModeBridge() {
  useEffect(() => {
    let frame = 0

    const sync = () => {
      frame = 0
      const root = document.querySelector('.yuisync-agenda-page')
      if (!root) return

      const daily = Boolean(root.querySelector('.yuisync-agenda-daily-grid'))
      root.dataset.yuisyncAgendaPeriod = daily ? 'day' : 'week'

      const periodButtons = [...root.querySelectorAll('.yuisync-agenda-period-toggle button')]
      const dailyButton = periodButtons.find((button) => String(button.textContent || '').trim().toLowerCase() === 'diaria')
      if (!dailyButton) return

      dailyButton.dataset.yuisyncAgendaPeriod = 'day'
      dailyButton.setAttribute('aria-pressed', String(daily))

      // Compatibility only: AgendaResolvedPage currently checks the legacy
      // "bg-amber" token. This class carries no visual rule; it simply keeps
      // that old detector alive from semantic state rather than theme color.
      dailyButton.classList.toggle('bg-amber-yuisync-daily-semantic', daily)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      const root = document.querySelector('.yuisync-agenda-page')
      root?.removeAttribute('data-yuisync-agenda-period')
      root?.querySelectorAll('.yuisync-agenda-period-toggle button').forEach((button) => {
        button.classList.remove('bg-amber-yuisync-daily-semantic')
        button.removeAttribute('data-yuisync-agenda-period')
        button.removeAttribute('aria-pressed')
      })
    }
  }, [])

  return null
}
