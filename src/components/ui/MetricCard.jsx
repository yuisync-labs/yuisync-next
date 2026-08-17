import { cardClasses } from './Card'

const TONE_STYLES = {
  neutral: {
    icon: 'bg-[var(--surface)] text-muted',
    value: 'text-text',
  },
  success: {
    icon: 'bg-[var(--ui-success-bg)] text-[var(--ui-success-fg)]',
    value: 'text-text',
  },
  warning: {
    icon: 'bg-[var(--ui-warning-bg)] text-[var(--ui-warning-fg)]',
    value: 'text-text',
  },
  danger: {
    icon: 'bg-[var(--ui-danger-bg)] text-[var(--ui-danger-fg)]',
    value: 'text-text',
  },
  info: {
    icon: 'bg-[var(--ui-info-bg)] text-[var(--ui-info-fg)]',
    value: 'text-text',
  },
}

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  tone = 'neutral',
  onClick,
  children,
  className = '',
}) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.neutral
  const Component = onClick ? 'button' : 'article'

  return (
    <Component
      {...(onClick ? { type: 'button', onClick, 'aria-label': `${label}: ${value}` } : {})}
      className={cardClasses({
        tone,
        interactive: Boolean(onClick),
        className: joinClasses('h-full w-full p-5 text-left', onClick && 'cursor-pointer', className),
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{label}</p>
          <p className={joinClasses('mt-2 font-display text-3xl font-bold leading-none tracking-tight', styles.value)}>{value}</p>
          {description && <p className="mt-2 text-xs leading-5 text-muted">{description}</p>}
        </div>
        {Icon && (
          <div className={joinClasses('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', styles.icon)}>
            <Icon size={16} strokeWidth={1.8} />
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </Component>
  )
}
