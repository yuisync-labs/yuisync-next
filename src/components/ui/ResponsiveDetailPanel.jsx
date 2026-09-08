import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function ResponsiveDetailPanel({
  open,
  title,
  description,
  onClose,
  busy = false,
  className = '',
  children,
  footer,
}) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => closeRef.current?.focus())
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      requestAnimationFrame(() => previousFocusRef.current?.focus?.({ preventScroll: true }))
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        aria-label="Fechar painel de atendimento"
        className="fixed inset-0 z-[89] bg-black/45 backdrop-blur-[1px] xl:hidden"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-label={title || 'Detalhes'}
        aria-busy={busy || undefined}
        className={joinClasses(
          'fixed inset-x-2 bottom-2 top-16 z-[90] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-surface shadow-2xl',
          'motion-safe:transition-[transform,opacity] motion-safe:duration-150 motion-reduce:transition-none',
          'xl:sticky xl:inset-auto xl:top-4 xl:z-20 xl:max-h-[calc(100vh-2rem)] xl:w-full xl:min-w-0 xl:self-start xl:shadow-lg',
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border2)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-bold text-text">{title}</h2>
            {description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Fechar painel"
            title="Fechar (Esc)"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-icon shrink-0"
          >
            <X size={16}/>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-[var(--border2)] bg-surface px-4 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </>
  )
}
