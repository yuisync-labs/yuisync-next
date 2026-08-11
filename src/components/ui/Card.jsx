const CARD_TONES = {
  neutral: 'border-[var(--border)] bg-card',
  subtle: 'border-[var(--border2)] bg-surface',
  success: 'border-emerald-500/25 bg-card',
  warning: 'border-amber-500/25 bg-card',
  danger: 'border-red-500/25 bg-card',
  info: 'border-[var(--primary-border)] bg-card',
}

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function cardClasses({ tone = 'neutral', interactive = false, className = '' } = {}) {
  return joinClasses(
    'rounded-[14px] border',
    CARD_TONES[tone] || CARD_TONES.neutral,
    interactive && 'transition-colors duration-150 hover:border-slate-400/60',
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
