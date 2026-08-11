const VARIANTS = {
  neutral: 'border-[var(--border)] bg-[var(--surface)] text-muted',
  success: 'border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] text-[var(--ui-success-fg)]',
  warning: 'border-[var(--ui-warning-border)] bg-[var(--ui-warning-bg)] text-[var(--ui-warning-fg)]',
  danger: 'border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] text-[var(--ui-danger-fg)]',
  info: 'border-[var(--ui-info-border)] bg-[var(--ui-info-bg)] text-[var(--ui-info-fg)]',
}

export function StatusBadge({ variant = 'neutral', className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${VARIANTS[variant] || VARIANTS.neutral} ${className}`}>
      {children}
    </span>
  )
}
