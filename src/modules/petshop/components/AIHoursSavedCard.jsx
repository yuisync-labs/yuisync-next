import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Timer } from 'lucide-react'
import { Card, StatusBadge } from '../../../components/ui'
import { calculateSavedPercentage, formatHours, formatPercentage } from '../utils/aiHoursSaved'

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  return (
    <Card tone="neutral" className="px-3 py-2">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-text">{formatHours(payload[0].value)}</p>
    </Card>
  )
}

export default function AIHoursSavedCard({
  totalHours = 0,
  savedHours = 0,
  series = [],
  className = '',
  onClick,
}) {
  const savedPercentage = useMemo(
    () => calculateSavedPercentage(savedHours, totalHours),
    [savedHours, totalHours]
  )

  const latestSaved = series?.[series.length - 1]?.saved ?? savedHours
  const hasMeasuredData = Number(savedHours || 0) > 0 && Array.isArray(series) && series.length > 0
  const helperText = `${formatHours(savedHours)} economizadas de ${formatHours(totalHours)} de operacao hoje`

  return (
    <Card
      as="article"
      tone="success"
      interactive={Boolean(onClick)}
      onClick={onClick}
      className={`p-5 ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-muted">Tempo economizado pela IA</p>
          <p className="mt-1 text-sm text-muted">Indicador de eficiência operacional</p>
        </div>
        <StatusBadge variant={hasMeasuredData ? 'success' : 'neutral'}>
          {hasMeasuredData ? 'Atualizado' : 'Sem amostra'}
        </StatusBadge>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
        <div>
          <p className="font-display text-5xl font-bold leading-none tracking-tight text-text">
            {hasMeasuredData ? formatPercentage(savedPercentage) : '—'}
          </p>
          <p className="mt-2 max-w-sm text-xs leading-5 text-muted">
            {hasMeasuredData ? helperText : 'Dados insuficientes para calcular a economia de hoje.'}
          </p>

          <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--surface)] px-3 py-2">
            <Timer size={15} className="text-emerald-600" />
            <div>
              <p className="text-[10px] font-medium text-muted">Economia hoje</p>
              <p className="text-sm font-semibold text-text">{hasMeasuredData ? formatHours(latestSaved) : '—'}</p>
            </div>
          </div>
        </div>

        <div className="h-36 min-w-0 rounded-[12px] border border-[var(--border2)] bg-[var(--surface)] p-2 sm:h-40">
          {hasMeasuredData ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={128} debounce={50}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="aiHoursFillClean" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  width={30}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 'dataMax + 0.6']}
                />
                <Tooltip cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="saved"
                  stroke="#059669"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fillOpacity={1}
                  fill="url(#aiHoursFillClean)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                  animationDuration={350}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-center text-sm font-medium text-muted">
              O indicador será exibido quando houver atendimentos da IA hoje.
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
