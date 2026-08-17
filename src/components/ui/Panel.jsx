import { Card, CardHeader, CardContent } from './Card'

function joinClasses(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function Panel({
  title,
  description,
  icon: Icon,
  action,
  tone = 'neutral',
  className = '',
  contentClassName = '',
  children,
  noPadding = false,
}) {
  return (
    <Card tone={tone} className={joinClasses('overflow-hidden', className)}>
      {(title || description || action) && (
        <CardHeader className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {Icon && <Icon size={16} strokeWidth={1.8} className="shrink-0 text-muted" />}
              {title && <h2 className="section-title">{title}</h2>}
            </div>
            {description && <p className="mt-1 text-xs leading-5 text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </CardHeader>
      )}
      {noPadding ? children : <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  )
}
