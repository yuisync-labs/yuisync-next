import { useEffect, useState, useCallback, useRef } from 'react'
import { AlertTriangle, TrendingUp, Calendar, MessageSquare, PawPrint, ArrowRight, ShoppingCart, ShieldAlert, Star, UserCheck } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { useProducts } from '../../../shared/hooks/useProducts'
import { useAppointments } from '../../../shared/hooks/useAppointments'
import { useSales } from '../../../shared/hooks/useSales'
import { useChat } from '../../../shared/hooks/useChat'
import { fmtCurrency, fmtTime, todayISO } from '../../../lib/supabase'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { usePerformanceCtx } from '../../../context/PerformanceContext'
import { useAnalytics } from '../../../shared/hooks/useAnalytics'
import { MetricCard, Panel, StatusBadge } from '../../../components/ui'
import AIHoursSavedCard from '../components/AIHoursSavedCard'
import { buildAIHoursFromScopedSessions } from '../utils/aiHoursSaved'
import { EmptyState, LoadingState } from '../../../components/PageState'

function RevenueMixCard({ value, sub, mix = [], onClick }) {
  const chartData = (mix || []).slice(0, 5)
  const piePalette = ['#059669', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444']

  return (
    <MetricCard
      icon={TrendingUp}
      label="Faturamento hoje"
      value={value}
      description={sub}
      tone="neutral"
      onClick={onClick}
    >
      {chartData.length === 0 ? (
        <p className="text-xs text-muted">Sem vendas concluídas hoje.</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="h-24 w-24 min-w-0 shrink-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={96} debounce={50}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="amount"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={23}
                  outerRadius={40}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                  paddingAngle={1}
                  animationDuration={350}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`${entry.label}-${index}`} fill={piePalette[index % piePalette.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(amount) => fmtCurrency(Number(amount || 0))}
                  contentStyle={{ borderRadius: 9, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {chartData.map((item, index) => (
              <div key={item.label} className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: piePalette[index % piePalette.length] }} />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="shrink-0">{fmtCurrency(item.amount || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </MetricCard>
  )
}

function StockAlert({ product }) {
  const isEmpty = product.stock_quantity === 0

  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-[var(--border2)] bg-[var(--surface)] px-3.5 py-3">
      <AlertTriangle size={15} className={isEmpty ? 'text-red-500' : 'text-amber-500'} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text">{product.name}</p>
        <p className="text-xs text-muted">{product.category}</p>
      </div>
      <StatusBadge variant={isEmpty ? 'danger' : 'warning'}>
        {isEmpty ? 'Esgotado' : `${product.stock_quantity} un`}
      </StatusBadge>
    </div>
  )
}

function ApptRow({ appt, serviceLabel, statusBadge, isAdmin }) {
  const sb = statusBadge(appt.status)
  return (
    <tr>
      <td>
        <span className="font-semibold text-text">{fmtTime(appt.scheduled_at)}</span>
      </td>
      <td>
        <p className="font-semibold text-text">{appt.pets?.pet_name || '—'}</p>
        <p className="text-xs text-muted">{appt.pets?.breed || appt.pets?.species}</p>
      </td>
      <td>{serviceLabel(appt.service_type)}</td>
      <td>
        <span className={`badge ${sb.cls}`}>{sb.label}</span>
      </td>
      {isAdmin && <td className="font-semibold text-emerald-600">{fmtCurrency(appt.price)}</td>}
    </tr>
  )
}

export default function DashboardPage({ setPage }) {
  const auth = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const { isFluidMode } = usePerformanceCtx()

  const isAdmin = auth?.profile?.role === 'admin'
    || (auth?.profile?.module_permissions || {})[activeModuleId]?.startsWith('admin_')

  const { getCriticalStock } = useProducts()
  const { load, appointments, todayStats, serviceLabel, statusBadge } = useAppointments()
  const { loadMetrics, getDailyStats } = useSales()
  const { loadSessions, sessions } = useChat()
  const { getChatResolutionMetrics } = useAnalytics()

  const [critical, setCritical] = useState([])
  const [stats, setStats] = useState({ revenue: 0, count: 0, upsells: 0, salesMix: [] })
  const [chatQuality, setChatQuality] = useState({ avgCsat: null, csatCount: 0, aiResolved: 0, humanResolved: 0, closedCount: 0, blockedReasons: {} })
  const [loading, setLoading] = useState(true)
  const [secondaryLoading, setSecondaryLoading] = useState(true)
  const refreshInFlightRef = useRef(false)
  const secondaryInFlightRef = useRef(false)
  const idleHandleRef = useRef(null)

  const loadSecondaryContent = useCallback(async () => {
    if (secondaryInFlightRef.current || document.hidden) return
    secondaryInFlightRef.current = true
    setSecondaryLoading(true)
    try {
      await Promise.all([
        loadMetrics(),
        getCriticalStock().then(setCritical),
        getChatResolutionMetrics().then(setChatQuality),
      ])
    } finally {
      secondaryInFlightRef.current = false
      setSecondaryLoading(false)
    }
  }, [loadMetrics, getCriticalStock, getChatResolutionMetrics])

  const scheduleSecondaryContent = useCallback(() => {
    if (document.hidden) return
    if (idleHandleRef.current) {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleHandleRef.current)
      else window.clearTimeout(idleHandleRef.current)
    }

    const run = () => {
      idleHandleRef.current = null
      void loadSecondaryContent()
    }

    if (isFluidMode && 'requestIdleCallback' in window) {
      idleHandleRef.current = window.requestIdleCallback(run, { timeout: 1200 })
    } else if (isFluidMode) {
      idleHandleRef.current = window.setTimeout(run, 240)
    } else {
      run()
    }
  }, [isFluidMode, loadSecondaryContent])

  const reloadAll = useCallback(async () => {
    if (refreshInFlightRef.current || document.hidden) return
    refreshInFlightRef.current = true
    setLoading(true)

    try {
      await Promise.all([
        load({ date: todayISO() }),
        loadSessions('bot'),
        getDailyStats().then(setStats),
      ])
      setLoading(false)
      scheduleSecondaryContent()
    } finally {
      refreshInFlightRef.current = false
      setLoading(false)
    }
  }, [load, loadSessions, getDailyStats, scheduleSecondaryContent])

  useEffect(() => {
    const intervalMs = isFluidMode ? 120_000 : 60_000
    const refreshWhenVisible = () => {
      if (!document.hidden) void reloadAll()
    }

    void reloadAll()
    const interval = window.setInterval(refreshWhenVisible, intervalMs)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      if (idleHandleRef.current) {
        if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleHandleRef.current)
        else window.clearTimeout(idleHandleRef.current)
        idleHandleRef.current = null
      }
    }
  }, [reloadAll, activeModuleId, isFluidMode])

  const ts = todayStats()
  const openChats = sessions.filter(s => s.status !== 'closed').length
  const aiHoursScoped = buildAIHoursFromScopedSessions(sessions, {
    totalHours: 8,
    savingPerSession: 0.4,
  })
  const topBlockedReasons = Object.entries(chatQuality.blockedReasons || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
  const blockedTotal = topBlockedReasons.reduce((sum, [, count]) => sum + Number(count || 0), 0)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'

  return (
    <div className="page animate-content">
      <div>
        <p className="text-xs font-semibold text-muted">Dashboard</p>
        <h1 className="page-title mt-1">{greeting}</h1>
        <p className="page-sub !mt-1">
          {now.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-12">
        <AIHoursSavedCard
          className="md:col-span-2 xl:col-span-8"
          totalHours={aiHoursScoped.totalHours}
          savedHours={aiHoursScoped.savedHours}
          series={aiHoursScoped.series}
        />
        <div className="xl:col-span-4 h-full">
          {isAdmin ? (
            <RevenueMixCard
              value={fmtCurrency(stats.revenue)}
              sub={`${stats.count} venda${stats.count !== 1 ? 's' : ''} • ${stats.upsells} upsells`}
              mix={stats.salesMix}
              onClick={() => setPage('vendas')}
            />
          ) : (
            <MetricCard
              icon={MessageSquare}
              label="Iniciações de chat"
              value={openChats}
              description={`${openChats} atendimentos ativos`}
              onClick={() => setPage('chat')}
            />
          )}
        </div>

        <div className="xl:col-span-4 h-full">
          <MetricCard
            icon={Calendar}
            label="Agendamentos hoje"
            value={ts.total}
            description={`${ts.agendado + ts.confirmado} pendentes • ${ts.concluido} concluídos`}
            onClick={() => setPage('agenda')}
          />
        </div>
        <div className="xl:col-span-4 h-full">
          <MetricCard
            icon={ShieldAlert}
            label="Estoque crítico"
            value={critical.length}
            description={`${critical.filter(p => p.stock_quantity === 0).length} produto(s) esgotado(s)`}
            tone={critical.length > 0 ? 'danger' : 'neutral'}
            onClick={() => setPage('estoque')}
          />
        </div>
        <div className="xl:col-span-4 h-full">
          <MetricCard
            icon={MessageSquare}
            label="Chats ativos"
            value={openChats}
            description={`${sessions.filter(s => s.status === 'bot').length} no bot`}
            onClick={() => setPage('chat')}
          />
        </div>
        <div className="xl:col-span-4 h-full">
          <MetricCard
            icon={Star}
            label="Satisfação IA"
            value={chatQuality.avgCsat === null ? '-' : chatQuality.avgCsat.toFixed(1)}
            description={`${chatQuality.csatCount} avaliação${chatQuality.csatCount !== 1 ? 'ões' : ''} coletada${chatQuality.csatCount !== 1 ? 's' : ''}`}
            onClick={() => setPage('chat')}
          />
        </div>
        <div className="xl:col-span-4 h-full">
          <MetricCard
            icon={UserCheck}
            label="Resolução de chat"
            value={`${chatQuality.aiResolved}/${chatQuality.humanResolved}`}
            description={`IA / humano em ${chatQuality.closedCount} encerrado${chatQuality.closedCount !== 1 ? 's' : ''}`}
            onClick={() => setPage('chat')}
          />
        </div>
        <div className="xl:col-span-4 h-full">
          <MetricCard
            icon={AlertTriangle}
            label="Alertas PetBot"
            value={blockedTotal}
            description={topBlockedReasons.length ? topBlockedReasons.map(([reason, count]) => `${reason}: ${count}`).join(' • ') : 'Sem bloqueios recentes'}
            tone={blockedTotal > 0 ? 'warning' : 'neutral'}
            onClick={() => setPage('chat')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel
          title="Agenda de hoje"
          className="lg:col-span-2"
          noPadding
          action={(
            <button onClick={() => setPage('agenda')} className="btn btn-ghost btn-sm">
              Ver tudo <ArrowRight size={12} />
            </button>
          )}
        >
          {loading ? (
            <LoadingState label="Carregando agenda de hoje..." />
          ) : appointments.length === 0 ? (
            <EmptyState
              title="Nenhum agendamento para hoje"
              description="A agenda está livre para novas reservas."
              action={<button onClick={() => setPage('agenda')} className="btn btn-secondary btn-sm">+ Novo agendamento</button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr>
                  <th>Hora</th><th>Pet</th><th>Serviço</th><th>Status</th>{isAdmin && <th>Valor</th>}
                </tr></thead>
                <tbody>
                  {appointments.slice(0, 8).map(a => (
                    <ApptRow key={a.id} appt={a} serviceLabel={serviceLabel} statusBadge={statusBadge} isAdmin={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Estoque crítico"
          icon={AlertTriangle}
          tone={critical.length > 0 ? 'warning' : 'neutral'}
          className="performance-deferred"
          contentClassName="max-h-[340px] space-y-2.5 overflow-y-auto p-4"
          action={(
            <button onClick={() => setPage('estoque')} className="btn btn-ghost btn-sm">
              Gerenciar <ArrowRight size={12} />
            </button>
          )}
        >
          {secondaryLoading ? (
            <LoadingState label="Verificando estoque..." />
          ) : critical.length === 0 ? (
            <EmptyState title="Estoque em dia" description="Nenhum produto está abaixo do mínimo." />
          ) : (
            critical.map(p => <StockAlert key={p.id} product={p} />)
          )}
        </Panel>
      </div>

      <Panel title="Ações rápidas" className="performance-deferred">
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setPage('agenda')} className="btn btn-secondary">
            <Calendar size={16} /> Novo agendamento
          </button>
          <button onClick={() => setPage('vendas')} className="btn btn-primary">
            <ShoppingCart size={16} /> Abrir PDV
          </button>
          <button onClick={() => setPage('pets')} className="btn btn-secondary">
            <PawPrint size={16} /> Cadastrar pet
          </button>
          <button onClick={() => setPage('chat')} className="btn btn-secondary">
            <MessageSquare size={16} /> Ver chats
          </button>
        </div>
      </Panel>
    </div>
  )
}
