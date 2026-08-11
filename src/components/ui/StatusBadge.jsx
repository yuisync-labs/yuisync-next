const VARIANTS = {
  neutral: 'border-[var(--border)] bg-[var(--surface)] text-muted',
  success: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400',
  warning: 'border-amber-500/20 bg-amber-500/8 text-amber-600 dark:text-amber-400',
  danger: 'border-red-500/20 bg-red-500/8 text-red-600 dark:text-red-400',
  info: 'border-[var(--primary-border)] bg-[var(--primary-bg-light)] text-primary',
}

export function StatusBadge({ variant = 'neutral', className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${VARIANTS[variant] || VARIANTS.neutral} ${className}`}>
      {children}
    </span>
  )
}
