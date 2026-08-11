const CARD_TONES = {
  neutral: 'border-[var(--border)] bg-card',
  subtle: 'border-[var(--border2)] bg-surface',
  success: 'border-[var(--ui-success-border)] bg-card',
  warning: 'border-[var(--ui-warning-border)] bg-card',
  danger: 'border-[var(--ui-danger-border)] bg-card',
  info: 'border-[var(--ui-info-border)] bg-card',
}

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function cardClasses({ tone = 'neutral', interactive = false, className = '' } = {}) {
  return joinClasses(
    'rounded-[14px] border',
    CARD_TONES[tone] || CARD_TONES.neutral,
    interactive && 'transition-colors duration-150 hover:border-[var(--ui-border-hover)]',
    className,
  )
}

export function Card({ as: Component = 'div', tone = 'neutral', interactive = false, className = '', children, ...props }) {
  return (
    <Component className={cardClasses({ tone, interactive, className })} {...props}>
      {children}
    </Component>
  )
}

export function CardHeader({ className = '', children }) {
  return <div className={joinClasses('border-b border-[var(--border2)] px-5 py-4', className)}>{children}</div>
}

export function CardContent({ className = '', children }) {
  return <div className={joinClasses('p-5', className)}>{children}</div>
}

export function CardFooter({ className = '', children }) {
  return <div className={joinClasses('border-t border-[var(--border2)] px-5 py-4', className)}>{children}</div>
}
