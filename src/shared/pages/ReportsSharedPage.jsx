import { useState, useEffect } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, Legend
} from 'recharts'
import { 
  TrendingUp, Users, Target, Activity, 
  ChevronRight, Phone, MessageSquare, AlertCircle, PawPrint, User
} from 'lucide-react'
import { useAnalytics } from '../hooks/useAnalytics'
import { useModuleCtx } from '../../context/ModuleContext'
import { fmtCurrency } from '../../lib/supabase'

export default function ReportsSharedPage() {
  const { activeModule, activeModuleId } = useModuleCtx()
  const { getOverviewMetrics, getDynamicRevenueChart, getCustomerInsights, loading } = useAnalytics()
  const isPetshop = activeModuleId === 'petshop'
  const chartAccent = isPetshop ? '#059669' : '#10b981'
  const chartGrid = isPetshop ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.05)'
  const chartAxis = isPetshop ? '#334155' : 'rgba(255,255,255,0.4)'
  const chartCursor = isPetshop ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.1)'

  const [overview, setOverview] = useState(null)
  const [chartData, setChartData] = useState([])
  const [atRisk, setAtRisk] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [range, setRange] = useState('mensal') // 'diario' | 'semanal' | 'mensal'

  useEffect(() => {
    async function load() {
      const [ov, ch, customers] = await Promise.all([
        getOverviewMetrics(),
        getDynamicRevenueChart(range),
        getCustomerInsights(),
      ])
      setOverview(ov)
      setChartData(ch || [])
      setAtRisk(customers?.atRisk || [])
      setTotalCount(customers?.activeCount || 0)
    }
    load()
  }, [getOverviewMetrics, getDynamicRevenueChart, getCustomerInsights, range])

  if (loading && !overview) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <Activity className="animate-spin text-muted" size={32} />
          <p className="text-muted font-semibold">Processando métricas do BI...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 space-y-8 animate-fade-up max-w-7xl mx-auto pb-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-text">Inteligência de Operação</h1>
          <p className="text-muted mt-1">Análise de desempenho e fidelização • {activeModule?.name}</p>
        </div>
        <div className="flex items-center gap-3 bg-surface border border-[var(--border2)] rounded-2xl px-4 py-2">
           <div className={`w-3 h-3 rounded-full ${activeModule?.theme.primaryBg} animate-pulse`} />
           <span className="text-sm font-bold text-text uppercase tracking-widest">Tempo Real</span>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          label="Faturamento no mês"
          val={fmtCurrency(overview?.current?.revenue || 0)}
          sub={comparisonText(overview?.changes?.revenue, overview?.current?.revenue)}
          icon={TrendingUp} col="emerald" 
        />
        <StatCard 
          label="Ticket médio no mês"
          val={fmtCurrency(overview?.current?.avgTicket || 0)}
          sub={comparisonText(overview?.changes?.avgTicket, overview?.current?.avgTicket)}
          icon={Target} col="blue" 
        />
        <StatCard 
          label="Vendas no mês"
          val={overview?.current?.count || 0}
          sub={comparisonText(overview?.changes?.count, overview?.current?.count)}
          icon={Activity} col="purple" 
        />
        <StatCard 
          label="Tutores compradores"
          val={overview?.current?.customerCount || 0}
          sub={`${comparisonText(overview?.changes?.customerCount, overview?.current?.customerCount)} • ${totalCount} na base`}
          icon={Users} col="amber" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-surface border border-[var(--border2)] rounded-3xl p-6 shadow-card overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="font-display font-bold text-lg text-text">Evolução do faturamento</h2>
              <p className="text-[10px] text-muted uppercase font-black tracking-widest mt-1">Período atual x período anterior • valores em R$</p>
            </div>
            <div className={`flex items-center p-1.5 rounded-xl border backdrop-blur-md ${
              isPetshop ? 'bg-slate-100 border-slate-200' : 'bg-white/[0.04] border-white/10'
            }`}>
               {['diario', 'semanal', 'mensal'].map(r => (
                 <button
                   key={r}
                   onClick={() => setRange(r)}
                    className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-300
                      ${range === r 
                       ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-105' 
                       : isPetshop
                         ? 'text-slate-700 hover:text-slate-900 hover:bg-white border border-slate-200'
                         : 'text-muted/80 hover:text-white hover:bg-white/5'}
                    `}
                  >
                   {r === 'diario' ? 'Diário' : r === 'semanal' ? 'Semanal' : 'Mensal'}
                 </button>
               ))}
            </div>
          </div>
          
          <div className="h-72 w-full -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartAccent} stopOpacity={0.35}/>
                    <stop offset="95%" stopColor={chartAccent} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGrid} />
                <XAxis 
                   dataKey="name" 
                   axisLine={false} 
                   tickLine={false} 
                   tick={{ fill: chartAxis, fontSize: 10, fontWeight: 700 }} 
                />
                <YAxis 
                   axisLine={false} 
                   tickLine={false} 
                   tick={{ fill: chartAxis, fontSize: 10, fontWeight: 700 }}
                   tickFormatter={(val) => `R$${val}`}
                />
                <Tooltip 
                  formatter={(value, name) => [fmtCurrency(value), name]}
                  contentStyle={isPetshop
                    ? { backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '12px', color: '#0F172A', fontSize: '12px' }
                    : { backgroundColor: 'rgb(30 41 59)', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px' }
                  }
                  itemStyle={{ color: isPetshop ? '#0F172A' : '#fff' }}
                  cursor={{stroke: chartCursor, strokeWidth: 2}}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area 
                  type="monotone" 
                  dataKey="current"
                  name="Período atual"
                  stroke={chartAccent} 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorTotal)" 
                />
                <Area
                  type="monotone"
                  dataKey="previous"
                  name="Período anterior"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Retention Column (CRM Lite) */}
        <div className="bg-surface border border-[var(--border2)] rounded-3xl flex flex-col shadow-card">
          <div className="p-6 border-b border-[var(--border2)]">
             <h2 className="font-display font-bold text-lg text-text flex items-center gap-2">
                <AlertCircle size={18} className="text-amber-500" />
                Fidelização em Risco
             </h2>
             <p className="text-xs text-muted mt-1 uppercase tracking-wider font-bold">Clientes há +30 dias sem compras</p>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
             {atRisk.length === 0 ? (
               <div className="p-8 text-center">
                 <p className="text-muted text-sm">Base de dados 100% ativa!</p>
               </div>
             ) : (
               atRisk.map((client, idx) => (
                 <div 
                   key={idx}
                   className="flex items-center gap-3 p-4 rounded-2xl hover:bg-white/5 transition-colors group"
                 >
                   <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-muted shadow-inner">
                      {activeModuleId === 'petshop' ? <PawPrint size={18}/> : <User size={18}/>}
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="font-bold text-sm text-text truncate">{client.owner_name || client.pet_name || 'Sem Nome'}</p>
                     <p className="text-xs text-muted">Visto em: {client.lastSeen === 'Nunca' ? 'Nunca' : new Date(client.lastSeen).toLocaleDateString('pt-BR')}</p>
                   </div>
                   <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a href={`tel:${client.phone}`} className="p-2 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20" title="Ligar">
                         <Phone size={14} />
                      </a>
                      <a href={`https://wa.me/55${client.phone?.replace(/\D/g,'')}`} target="_blank" className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20" title="WhatsApp">
                         <MessageSquare size={14} />
                      </a>
                   </div>
                 </div>
               ))
             )}
          </div>
          
          <div className="p-4 mt-auto border-t border-[var(--border2)]">
             <button className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-text bg-white/5 hover:bg-white/10 rounded-xl transition-all">
                Ver todos os clientes <ChevronRight size={14} />
             </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function comparisonText(change, currentValue) {
  if (change === null || change === undefined) {
    return Number(currentValue || 0) > 0 ? 'Novo no período comparado' : 'Sem movimento nos dois períodos'
  }
  const normalized = Math.abs(change) < 0.05 ? 0 : change
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)}% vs período anterior`
}

function StatCard({ label, val, sub, icon: Icon, col }) {
  const colors = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
    purple:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
    amber:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }

  return (
    <div className="bg-surface border border-[var(--border2)] rounded-3xl p-6 shadow-card transition-all hover:translate-y-[-2px] hover:border-transparent">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-xl ${colors[col]} border`}>
          <Icon size={20} />
        </div>
        <span className="text-[10px] font-bold text-muted uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-2xl font-display font-bold text-text truncate">{val}</p>
      <p className="text-xs text-muted mt-1">{sub}</p>
    </div>
  )
}
