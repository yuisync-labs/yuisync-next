import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  LifeBuoy,
  Link2,
  Loader2,
  Phone,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp,
  UserPlus,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtCurrency } from '../../../lib/supabase'
import { useClients } from '../../../shared/hooks/useClients'
import { usePetshopGrowth } from '../hooks/usePetshopGrowth'

const REQUEST_STATUS_META = {
  pending: { label: 'Pendente', cls: 'badge-gray' },
  contacted: { label: 'Contato iniciado', cls: 'badge-blue' },
  scheduled: { label: 'Agendado', cls: 'badge-green' },
  cancelled: { label: 'Cancelado', cls: 'badge-red' },
  lost: { label: 'Perdido', cls: 'badge-amber' },
}

const LEAD_STAGE_META = {
  new: { label: 'Novo', cls: 'badge-blue' },
  contacted: { label: 'Contato', cls: 'badge-amber' },
  proposal: { label: 'Proposta', cls: 'badge-purple' },
  won: { label: 'Fechado', cls: 'badge-green' },
  lost: { label: 'Perdido', cls: 'badge-red' },
}

const NO_SHOW_EVENT_META = {
  no_show: { label: 'No-show', cls: 'badge-red' },
  late_cancel: { label: 'Cancelamento tardio', cls: 'badge-amber' },
  recovered: { label: 'Recuperado', cls: 'badge-green' },
  fee_paid: { label: 'Taxa paga', cls: 'badge-blue' },
}

const PORTAL_STATUS_META = {
  active: { label: 'Ativo', cls: 'badge-green' },
  paused: { label: 'Pausado', cls: 'badge-amber' },
  revoked: { label: 'Revogado', cls: 'badge-red' },
}

const GROWTH_GUIDE_STEPS = [
  'Use esta aba para organizar o antes e o depois do atendimento: interesse, contato, falta, retorno e acompanhamento.',
  'Depois de uma ligacao ou conversa no WhatsApp, voce pode registrar a solicitacao, transformar em lead e nao perder o cliente.',
  'Quando houver falta ou cancelamento em cima da hora, o bloco de no-show ajuda a registrar isso e acompanhar reincidencias.',
  'O report card serve como resumo do atendimento: o que foi feito, cuidados e quando vale chamar o tutor de volta.',
  'O portal do cliente libera um link simples para o tutor acompanhar informacoes e proximos passos do pet.',
]

const GROWTH_TEST_CHECKLIST = [
  'Criar uma solicitacao nova e acompanhar a mudanca de status ate "Agendado".',
  'Mover um lead entre os estagios e validar se o dashboard executivo atualiza.',
  'Registrar um no-show e confirmar se o evento aparece na lista.',
  'Salvar um report card e marcar como entregue.',
  'Liberar um portal para um cliente e abrir o link gerado.',
]

const toBRDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('pt-BR')
}

const toBRDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const isMissingClientIdColumnError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('client_id') && message.includes('does not exist')
}

function StatCard({ label, value, sub, icon: Icon, tone = 'text-emerald-400' }) {
  return (
    <div className="bg-card border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted font-bold">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className={`font-display font-bold text-3xl ${tone}`}>{value}</p>
      {sub && <p className="text-sm text-muted mt-1">{sub}</p>}
    </div>
  )
}

function comparisonText(change, currentValue) {
  if (change === null || change === undefined) {
    return Number(currentValue || 0) > 0 ? 'Novo vs período anterior' : 'Sem movimento nos dois períodos'
  }
  const normalized = Math.abs(change) < 0.05 ? 0 : change
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)}% vs período anterior`
}

function ExplainerPanel({ title, items, tone = 'emerald' }) {
  return (
    <div className={`rounded-2xl border px-5 py-5 ${tone === 'amber' ? 'border-amber-500/20 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
      <p className="text-sm font-semibold text-text">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {items.map((item) => (
          <div key={item} className="rounded-xl border border-white/10 bg-white/40 px-4 py-3 text-sm text-text">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function GrowthPage() {
  const {
    loadBookingSettings,
    saveBookingSettings,
    loadBookingRequests,
    createBookingRequest,
    updateBookingRequest,
    loadLeads,
    createLead,
    updateLead,
    promoteRequestToLead,
    loadNoShowPolicy,
    saveNoShowPolicy,
    loadNoShowEvents,
    registerNoShowEvent,
    loadReportCards,
    saveReportCard,
    loadPortalAccess,
    upsertPortalAccess,
    updatePortalAccess,
    buildPortalLink,
    loadExecutiveTimeline,
  } = usePetshopGrowth()

  const { clients, load: loadClients } = useClients()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [bookingSettings, setBookingSettings] = useState(null)
  const [bookingRequests, setBookingRequests] = useState([])
  const [leads, setLeads] = useState([])
  const [noShowPolicy, setNoShowPolicy] = useState(null)
  const [noShowEvents, setNoShowEvents] = useState([])
  const [reportCards, setReportCards] = useState([])
  const [portalAccess, setPortalAccess] = useState([])
  const [timeline, setTimeline] = useState([])
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    totalSales: 0,
    newLeads: 0,
    wonLeads: 0,
    noShows: 0,
    bookings: 0,
    bookingsScheduled: 0,
    reportCardsSent: 0,
  })
  const [changes, setChanges] = useState({
    totalRevenue: 0,
    newLeads: 0,
    noShows: 0,
    reportCardsSent: 0,
  })

  const [daysRange, setDaysRange] = useState(14)

  const [bookingForm, setBookingForm] = useState({
    customer_name: '',
    pet_name: '',
    phone: '',
    service_interest: '',
    preferred_date: '',
    preferred_period: 'manha',
    channel: 'manual',
    transport_mode: 'dropoff',
    need_motodog: false,
    pickup_address: '',
    pickup_neighborhood: '',
    pickup_city: '',
    notes: '',
  })

  const [leadForm, setLeadForm] = useState({
    owner_name: '',
    pet_name: '',
    phone: '',
    interest: '',
    source: 'manual',
    stage: 'new',
    priority: 'normal',
  })

  const [noShowForm, setNoShowForm] = useState({
    client_id: '',
    event_type: 'no_show',
    fee_amount: 0,
    notes: '',
  })

  const [reportForm, setReportForm] = useState({
    client_id: '',
    pet_name: '',
    summary: '',
    care_tips: '',
    next_visit_date: '',
    delivery_channel: 'whatsapp',
  })

  const [portalClientId, setPortalClientId] = useState('')
  const [copyingLinkId, setCopyingLinkId] = useState('')

  const chartData = useMemo(() => (
    timeline.map((row) => {
      const label = new Date(`${row.ref_date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      return {
        name: label,
        receita: Number(row.total_revenue || 0),
        leads: Number(row.new_leads || 0),
        noShow: Number(row.no_show_count || 0),
      }
    })
  ), [timeline])

  const bookingUrl = useMemo(() => {
    if (!bookingSettings?.public_slug) return '-'
    if (typeof window === 'undefined') return `/agendar/${bookingSettings.public_slug}`
    return `${window.location.origin}/agendar/${bookingSettings.public_slug}`
  }, [bookingSettings?.public_slug])

  async function reloadAll(range = daysRange) {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await loadClients()
      const [
        settings,
        requests,
        leadRows,
        policy,
        events,
        cards,
        portalRows,
        execData,
      ] = await Promise.all([
        loadBookingSettings(),
        loadBookingRequests(),
        loadLeads(),
        loadNoShowPolicy(),
        loadNoShowEvents(),
        loadReportCards(),
        loadPortalAccess(),
        loadExecutiveTimeline({ days: range }),
      ])

      setBookingSettings(settings)
      setBookingRequests(requests)
      setLeads(leadRows)
      setNoShowPolicy(policy)
      setNoShowEvents(events)
      setReportCards(cards)
      setPortalAccess(portalRows)
      setTimeline(execData.timeline)
      setSummary(execData.summary)
      setChanges(execData.changes)
    } catch (err) {
      setError(err.message || 'Falha ao carregar o painel de crescimento.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadAll(daysRange)
  }, [])

  async function handleRefresh() {
    await reloadAll(daysRange)
  }

  async function handleSaveBookingSettings() {
    if (!bookingSettings) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const saved = await saveBookingSettings(bookingSettings)
      setBookingSettings(saved)
      setSuccess('Configuracao de agendamento online atualizada.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateBookingRequest() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await createBookingRequest(bookingForm)
      setBookingForm({
        customer_name: '',
        pet_name: '',
        phone: '',
        service_interest: '',
        preferred_date: '',
        preferred_period: 'manha',
        channel: 'manual',
        transport_mode: 'dropoff',
        need_motodog: false,
        pickup_address: '',
        pickup_neighborhood: '',
        pickup_city: '',
        notes: '',
      })
      await reloadAll(daysRange)
      setSuccess('Solicitacao de agendamento registrada.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleBookingStatus(request, status) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updateBookingRequest(request.id, { status })
      await reloadAll(daysRange)
      setSuccess('Status da solicitacao atualizado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePromoteToLead(request) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await promoteRequestToLead(request)
      await reloadAll(daysRange)
      setSuccess('Solicitacao movida para o funil de leads.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateLead() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await createLead(leadForm)
      setLeadForm({
        owner_name: '',
        pet_name: '',
        phone: '',
        interest: '',
        source: 'manual',
        stage: 'new',
        priority: 'normal',
      })
      await reloadAll(daysRange)
      setSuccess('Lead criado com sucesso.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleLeadStage(lead, stage) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updateLead(lead.id, { stage, last_contact_at: new Date().toISOString() })
      await reloadAll(daysRange)
      setSuccess('Estagio do lead atualizado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveNoShowPolicy() {
    if (!noShowPolicy) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const saved = await saveNoShowPolicy(noShowPolicy)
      setNoShowPolicy(saved)
      setSuccess('Politica anti no-show atualizada.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRegisterNoShowEvent() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await registerNoShowEvent({
        ...noShowForm,
        fee_amount: Number(noShowForm.fee_amount || 0),
        client_id: noShowForm.client_id || null,
      })
      setNoShowForm({
        client_id: '',
        event_type: 'no_show',
        fee_amount: 0,
        notes: '',
      })
      await reloadAll(daysRange)
      setSuccess('Evento de no-show registrado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateReportCard() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await saveReportCard({
        ...reportForm,
        client_id: reportForm.client_id || null,
      })
      setReportForm({
        client_id: '',
        pet_name: '',
        summary: '',
        care_tips: '',
        next_visit_date: '',
        delivery_channel: 'whatsapp',
      })
      await reloadAll(daysRange)
      setSuccess('Report card salvo para o atendimento.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkReportDelivered(card) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await saveReportCard({
        id: card.id,
        client_id: card.client_id,
        appointment_id: card.appointment_id,
        pet_name: card.pet_name,
        summary: card.summary,
        care_tips: card.care_tips,
        next_visit_date: card.next_visit_date,
        delivery_channel: card.delivery_channel,
        delivered: true,
        recommended_services: card.recommended_services || [],
      })
      await reloadAll(daysRange)
      setSuccess('Report card marcado como entregue.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleGeneratePortalAccess() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await upsertPortalAccess({
        client_id: portalClientId,
        status: 'active',
      })
      setPortalClientId('')
      await reloadAll(daysRange)
      setSuccess('Acesso ao portal do cliente gerado.')
    } catch (err) {
      setError(
        isMissingClientIdColumnError(err)
          ? 'O portal foi liberado, mas o resumo executivo ainda depende de um ajuste SQL no Supabase. A tela continuou funcionando com fallback local.'
          : err.message
      )
    } finally {
      setSaving(false)
    }
  }

  async function handlePortalStatus(access, status) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updatePortalAccess(access.id, { status })
      await reloadAll(daysRange)
      setSuccess('Status do portal atualizado.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCopyPortalLink(access) {
    const url = buildPortalLink(access.portal_token)
    try {
      setCopyingLinkId(access.id)
      await navigator.clipboard.writeText(url)
      setSuccess('Link do portal copiado para a area de transferencia.')
    } catch {
      setError('Nao foi possivel copiar automaticamente. Copie manualmente o link exibido.')
    } finally {
      setCopyingLinkId('')
    }
  }

  async function handleChangeRange(nextRange) {
    setDaysRange(nextRange)
    setLoading(true)
    setError('')
    try {
      const exec = await loadExecutiveTimeline({ days: nextRange })
      setTimeline(exec.timeline)
      setSummary(exec.summary)
      setChanges(exec.changes)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page animate-fade-up space-y-6 pb-20">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <TrendingUp size={22} className="text-emerald-500" />
            Crescimento CRM
          </h1>
          <p className="page-sub">
            Agendamento online, protecao no-show, report card, esteira de leads, portal do cliente e BI executivo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} className="btn btn-secondary" disabled={loading || saving}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExplainerPanel title="Como esta aba funciona" items={GROWTH_GUIDE_STEPS} />
        <ExplainerPanel title="Checklist rapido de testes" items={GROWTH_TEST_CHECKLIST} tone="amber" />
      </div>

      <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-5 py-4">
        <p className="text-sm font-semibold text-text">Na pratica, para que serve?</p>
        <p className="mt-2 text-sm text-muted leading-6">
          Pense nessa aba como o seu controle comercial e de relacionamento do PetShop. Ela nao e um discador nem uma central de ligacoes.
          Ela serve para registrar o que aconteceu antes do agendamento, durante a recuperacao de clientes e depois do atendimento.
          Se um tutor ligou pedindo banho, se sumiu depois do orcamento, se faltou, ou se voce quer mandar um resumo profissional do atendimento,
          essa aba e o lugar para deixar tudo organizado.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2">
          <ShieldAlert size={14} />
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2">
          <CheckCircle2 size={14} />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Receita no período" value={fmtCurrency(summary.totalRevenue)} sub={comparisonText(changes.totalRevenue, summary.totalRevenue)} icon={BarChart3} tone="text-emerald-400" />
        <StatCard label="Leads novos" value={summary.newLeads} sub={`${summary.wonLeads} fechados • ${comparisonText(changes.newLeads, summary.newLeads)}`} icon={Target} tone="text-sky-400" />
        <StatCard label="No-shows registrados" value={summary.noShows} sub={comparisonText(changes.noShows, summary.noShows)} icon={AlertTriangle} tone="text-amber-400" />
        <StatCard label="Report cards enviados" value={summary.reportCardsSent} sub={comparisonText(changes.reportCardsSent, summary.reportCardsSent)} icon={ClipboardCheck} tone="text-violet-400" />
      </div>

      <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="section-title flex items-center gap-2">
            <BarChart3 size={16} className="text-emerald-400" />
            Dashboard executivo
          </h2>
          <div className="flex items-center gap-2">
            {[14, 30, 60].map((range) => (
              <button
                key={range}
                onClick={() => handleChangeRange(range)}
                className={`btn btn-sm ${daysRange === range ? 'btn-primary' : 'btn-secondary'}`}
                disabled={loading}
              >
                {range} dias
              </button>
            ))}
          </div>
        </div>
        <div className="h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260} debounce={50}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="growthRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="growthLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <YAxis
                yAxisId="revenue"
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickFormatter={(value) => `R$ ${Number(value).toLocaleString('pt-BR', { notation: 'compact' })}`}
              />
              <YAxis
                yAxisId="volume"
                orientation="right"
                allowDecimals={false}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
              />
              <Tooltip
                formatter={(value, name) => [name === 'Receita' ? fmtCurrency(value) : value, name]}
                contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)' }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="revenue" type="monotone" dataKey="receita" name="Receita" stroke="#059669" fill="url(#growthRevenue)" strokeWidth={2.4} />
              <Area yAxisId="volume" type="monotone" dataKey="leads" name="Leads" stroke="#0ea5e9" fill="url(#growthLeads)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-emerald-400" />
            <h2 className="section-title">1) Agendamento Online</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm text-muted flex items-center gap-2">
              <input
                aria-label="Exigir sinal para agendamento"
                aria-label="Receber solicitacoes online"
                type="checkbox"
                checked={bookingSettings?.enabled || false}
                onChange={(event) => setBookingSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              Receber solicitacoes online
            </label>
            <label className="text-sm text-muted flex items-center gap-2">
              <input
                aria-label="Permitir fallback para WhatsApp"
                type="checkbox"
                checked={bookingSettings?.allow_whatsapp_fallback || false}
                onChange={(event) => setBookingSettings((prev) => ({ ...prev, allow_whatsapp_fallback: event.target.checked }))}
              />
              Fallback para WhatsApp
            </label>
            <div>
              <label className="inp-label">Slug publico</label>
              <input
                aria-label="Slug publico"
                className="inp"
                value={bookingSettings?.public_slug || ''}
                onChange={(event) => setBookingSettings((prev) => ({ ...prev, public_slug: event.target.value }))}
                placeholder="agenda-petshop"
              />
            </div>
            <div>
              <label className="inp-label">Expirar lead (horas)</label>
              <input
                aria-label="Expiracao do lead em horas"
                className="inp"
                type="number"
                min="1"
                value={bookingSettings?.lead_expiration_hours || 6}
                onChange={(event) => setBookingSettings((prev) => ({ ...prev, lead_expiration_hours: Number(event.target.value || 6) }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="inp-label">Mensagem inicial</label>
              <textarea
                aria-label="Mensagem inicial do agendamento"
                className="inp h-20 resize-none"
                value={bookingSettings?.intake_message || ''}
                onChange={(event) => setBookingSettings((prev) => ({ ...prev, intake_message: event.target.value }))}
              />
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-muted">
            Link de agendamento: <span className="text-text font-semibold">{bookingUrl}</span>
          </div>
          <button onClick={handleSaveBookingSettings} className="btn btn-primary" disabled={saving || loading}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            Salvar configuracao
          </button>

          <div className="pt-2 border-t border-[var(--border2)] space-y-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted font-bold">Nova solicitacao</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input aria-label="Nome do tutor" className="inp" placeholder="Tutor" value={bookingForm.customer_name} onChange={(e) => setBookingForm((prev) => ({ ...prev, customer_name: e.target.value }))} />
              <input aria-label="Nome do pet" className="inp" placeholder="Pet" value={bookingForm.pet_name} onChange={(e) => setBookingForm((prev) => ({ ...prev, pet_name: e.target.value }))} />
              <input aria-label="Telefone do tutor" className="inp" placeholder="Telefone" value={bookingForm.phone} onChange={(e) => setBookingForm((prev) => ({ ...prev, phone: e.target.value }))} />
              <input aria-label="Servico de interesse" className="inp" placeholder="Servico" value={bookingForm.service_interest} onChange={(e) => setBookingForm((prev) => ({ ...prev, service_interest: e.target.value }))} />
              <input aria-label="Data preferencial" className="inp" type="date" value={bookingForm.preferred_date} onChange={(e) => setBookingForm((prev) => ({ ...prev, preferred_date: e.target.value }))} />
              <select aria-label="Periodo preferencial" className="inp" value={bookingForm.preferred_period} onChange={(e) => setBookingForm((prev) => ({ ...prev, preferred_period: e.target.value }))}>
                <option value="manha">Manha</option>
                <option value="tarde">Tarde</option>
                <option value="noite">Noite</option>
              </select>
              <select aria-label="Forma de transporte" className="inp" value={bookingForm.transport_mode} onChange={(e) => setBookingForm((prev) => ({ ...prev, transport_mode: e.target.value, need_motodog: e.target.value === 'pickup' }))}>
                <option value="dropoff">Vou levar ate o PetShop</option>
                <option value="pickup">Precisa de MotoDog</option>
              </select>
              <p className="flex items-center text-xs text-muted">A taxa do MotoDog e calculada pela configuracao do PetShop.</p>
            </div>
            {bookingForm.need_motodog && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input aria-label="Cidade de retirada" className="inp" placeholder="Cidade" value={bookingForm.pickup_city} onChange={(e) => setBookingForm((prev) => ({ ...prev, pickup_city: e.target.value }))} />
                <input aria-label="Bairro de retirada" className="inp" placeholder="Bairro" value={bookingForm.pickup_neighborhood} onChange={(e) => setBookingForm((prev) => ({ ...prev, pickup_neighborhood: e.target.value }))} />
                <input aria-label="Endereco completo de retirada" className="inp" placeholder="Endereco completo" value={bookingForm.pickup_address} onChange={(e) => setBookingForm((prev) => ({ ...prev, pickup_address: e.target.value }))} />
              </div>
            )}
            <button onClick={handleCreateBookingRequest} className="btn btn-secondary" disabled={saving || loading}>
              <UserPlus size={15} />
              Registrar solicitacao
            </button>
          </div>
        </div>

        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-sky-400" />
            <h2 className="section-title">2) Leads e abandono de agendamento</h2>
          </div>
          <p className="text-sm text-muted">
            Use quando o tutor demonstrou interesse mas ainda nao virou venda ou agendamento confirmado.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input aria-label="Nome do tutor do lead" className="inp" placeholder="Nome do tutor" value={leadForm.owner_name} onChange={(e) => setLeadForm((prev) => ({ ...prev, owner_name: e.target.value }))} />
            <input aria-label="Nome do pet do lead" className="inp" placeholder="Pet" value={leadForm.pet_name} onChange={(e) => setLeadForm((prev) => ({ ...prev, pet_name: e.target.value }))} />
            <input aria-label="Telefone do lead" className="inp" placeholder="Telefone" value={leadForm.phone} onChange={(e) => setLeadForm((prev) => ({ ...prev, phone: e.target.value }))} />
            <input aria-label="Interesse do lead" className="inp" placeholder="Interesse" value={leadForm.interest} onChange={(e) => setLeadForm((prev) => ({ ...prev, interest: e.target.value }))} />
          </div>
          <button onClick={handleCreateLead} className="btn btn-primary" disabled={saving || loading}>
            <UserPlus size={15} />
            Criar lead
          </button>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border2)]">
            {leads.map((lead) => {
              const stageMeta = LEAD_STAGE_META[lead.stage] || LEAD_STAGE_META.new
              return (
                <div key={lead.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-text">{lead.owner_name}</p>
                    <span className={`badge ${stageMeta.cls}`}>{stageMeta.label}</span>
                  </div>
                  <p className="text-xs text-muted">{lead.pet_name || lead.client?.pet_name || 'Pet nao informado'} • {lead.phone || '-'}</p>
                  <p className="text-xs text-muted">{lead.interest || 'Interesse nao informado'}</p>
                  <select
                    aria-label={`Etapa do lead ${lead.owner_name}`}
                    className="inp !h-9"
                    value={lead.stage}
                    onChange={(event) => handleLeadStage(lead, event.target.value)}
                    disabled={saving}
                  >
                    <option value="new">Novo</option>
                    <option value="contacted">Contato</option>
                    <option value="proposal">Proposta</option>
                    <option value="won">Fechado</option>
                    <option value="lost">Perdido</option>
                  </select>
                </div>
              )
            })}
            {!leads.length && !loading && (
              <div className="p-6 text-sm text-muted text-center">Nenhum lead registrado.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <LifeBuoy size={16} className="text-amber-400" />
            <h2 className="section-title">3) Protecao de no-show</h2>
          </div>
          <p className="text-sm text-muted">
            Aqui voce controla faltas, taxa, sinal e recuperacao de horarios perdidos.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm text-muted flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={noShowPolicy?.require_prepayment || false}
                onChange={(event) => setNoShowPolicy((prev) => ({ ...prev, require_prepayment: event.target.checked }))}
              />
              Exigir sinal para agendamento
            </label>
            <div>
              <label className="inp-label">Valor sinal</label>
              <input aria-label="Valor do sinal" className="inp" type="number" min="0" step="0.01" value={noShowPolicy?.prepayment_amount || 0} onChange={(e) => setNoShowPolicy((prev) => ({ ...prev, prepayment_amount: Number(e.target.value || 0) }))} />
            </div>
            <div>
              <label className="inp-label">Tolerancia (min)</label>
              <input aria-label="Tolerancia em minutos" className="inp" type="number" min="0" value={noShowPolicy?.grace_minutes || 15} onChange={(e) => setNoShowPolicy((prev) => ({ ...prev, grace_minutes: Number(e.target.value || 15) }))} />
            </div>
            <div>
              <label className="inp-label">Max. faltas</label>
              <input aria-label="Quantidade maxima de faltas" className="inp" type="number" min="1" value={noShowPolicy?.max_strikes || 2} onChange={(e) => setNoShowPolicy((prev) => ({ ...prev, max_strikes: Number(e.target.value || 2) }))} />
            </div>
            <div>
              <label className="inp-label">Lembrete antes (min)</label>
              <input aria-label="Antecedencia do lembrete em minutos" className="inp" type="number" min="15" value={noShowPolicy?.reminder_minutes_before || 90} onChange={(e) => setNoShowPolicy((prev) => ({ ...prev, reminder_minutes_before: Number(e.target.value || 90) }))} />
            </div>
          </div>
          <button onClick={handleSaveNoShowPolicy} className="btn btn-primary" disabled={saving || loading}>
            <CheckCircle2 size={15} />
            Salvar politica
          </button>

          <div className="pt-2 border-t border-[var(--border2)] space-y-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted font-bold">Registrar ocorrencia</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select aria-label="Cliente da ocorrencia" className="inp" value={noShowForm.client_id} onChange={(e) => setNoShowForm((prev) => ({ ...prev, client_id: e.target.value }))}>
                <option value="">Cliente (opcional)</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.pet_name || client.owner_name} - {client.owner_name}
                  </option>
                ))}
              </select>
              <select aria-label="Tipo de ocorrencia" className="inp" value={noShowForm.event_type} onChange={(e) => setNoShowForm((prev) => ({ ...prev, event_type: e.target.value }))}>
                <option value="no_show">No-show</option>
                <option value="late_cancel">Cancelamento tardio</option>
                <option value="recovered">Recuperado</option>
                <option value="fee_paid">Taxa paga</option>
              </select>
              <input aria-label="Taxa da ocorrencia" className="inp" type="number" step="0.01" min="0" value={noShowForm.fee_amount} onChange={(e) => setNoShowForm((prev) => ({ ...prev, fee_amount: e.target.value }))} placeholder="Taxa (opcional)" />
              <input aria-label="Observacao da ocorrencia" className="inp" value={noShowForm.notes} onChange={(e) => setNoShowForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Observacao" />
            </div>
            <button onClick={handleRegisterNoShowEvent} className="btn btn-secondary" disabled={saving || loading}>
              <AlertTriangle size={15} />
              Registrar evento
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border2)]">
            {noShowEvents.map((event) => {
              const meta = NO_SHOW_EVENT_META[event.event_type] || NO_SHOW_EVENT_META.no_show
              return (
                <div key={event.id} className="p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-text font-semibold">
                      {event.client?.pet_name || event.client?.owner_name || 'Cliente nao vinculado'}
                    </p>
                    <p className="text-xs text-muted">{toBRDateTime(event.created_at)} - {event.notes || 'Sem observacao'}</p>
                  </div>
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                </div>
              )
            })}
            {!noShowEvents.length && !loading && (
              <div className="p-6 text-sm text-muted text-center">Nenhum evento de no-show registrado.</div>
            )}
          </div>
        </div>

        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-violet-400" />
            <h2 className="section-title">4) Report Card do atendimento</h2>
          </div>
          <p className="text-sm text-muted">
            Funciona como um pos-atendimento: resumo do que foi feito, cuidados e proxima visita recomendada.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select aria-label="Cliente do report card" className="inp" value={reportForm.client_id} onChange={(e) => setReportForm((prev) => ({ ...prev, client_id: e.target.value }))}>
              <option value="">Cliente (opcional)</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.pet_name || client.owner_name} - {client.owner_name}
                </option>
              ))}
            </select>
            <input aria-label="Nome do pet do report card" className="inp" placeholder="Nome do pet" value={reportForm.pet_name} onChange={(e) => setReportForm((prev) => ({ ...prev, pet_name: e.target.value }))} />
            <textarea aria-label="Resumo do atendimento" className="inp md:col-span-2 h-20 resize-none" placeholder="Resumo do atendimento" value={reportForm.summary} onChange={(e) => setReportForm((prev) => ({ ...prev, summary: e.target.value }))} />
            <textarea aria-label="Cuidados recomendados" className="inp md:col-span-2 h-16 resize-none" placeholder="Cuidados recomendados" value={reportForm.care_tips} onChange={(e) => setReportForm((prev) => ({ ...prev, care_tips: e.target.value }))} />
            <input aria-label="Data da proxima visita" className="inp" type="date" value={reportForm.next_visit_date} onChange={(e) => setReportForm((prev) => ({ ...prev, next_visit_date: e.target.value }))} />
            <select aria-label="Canal de entrega do report card" className="inp" value={reportForm.delivery_channel} onChange={(e) => setReportForm((prev) => ({ ...prev, delivery_channel: e.target.value }))}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <button onClick={handleCreateReportCard} className="btn btn-primary" disabled={saving || loading}>
            <ClipboardCheck size={15} />
            Salvar report card
          </button>

          <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border2)]">
            {reportCards.map((card) => (
              <div key={card.id} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-text">{card.pet_name || card.client?.pet_name || card.client?.owner_name || 'Pet nao informado'}</p>
                  <span className={`badge ${card.delivered ? 'badge-green' : 'badge-gray'}`}>
                    {card.delivered ? 'Entregue' : 'Pendente'}
                  </span>
                </div>
                <p className="text-xs text-muted">{card.summary}</p>
                <p className="text-xs text-muted">{toBRDate(card.next_visit_date)} - {card.delivery_channel}</p>
                {!card.delivered && (
                  <button
                    onClick={() => handleMarkReportDelivered(card)}
                    className="btn btn-secondary btn-sm"
                    disabled={saving}
                  >
                    <CheckCircle2 size={13} />
                    Marcar como entregue
                  </button>
                )}
              </div>
            ))}
            {!reportCards.length && !loading && (
              <div className="p-6 text-sm text-muted text-center">Nenhum report card registrado.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-emerald-400" />
            <h2 className="section-title">5) Portal do cliente</h2>
          </div>
          <p className="text-sm text-muted">
            Libere somente quando quiser entregar uma experiencia mais premium, com link individual para o tutor acompanhar dados do pet.
          </p>
          <div className="flex items-center gap-3">
            <select aria-label="Cliente para liberar portal" className="inp flex-1" value={portalClientId} onChange={(e) => setPortalClientId(e.target.value)}>
              <option value="">Selecione o cliente para liberar portal</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.pet_name || client.owner_name} - {client.owner_name}
                </option>
              ))}
            </select>
            <button onClick={handleGeneratePortalAccess} disabled={!portalClientId || saving || loading} className="btn btn-primary">
              Liberar
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border2)]">
            {portalAccess.map((access) => {
              const statusMeta = PORTAL_STATUS_META[access.status] || PORTAL_STATUS_META.active
              const link = buildPortalLink(access.portal_token)
              return (
                <div key={access.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-text">{access.client?.pet_name || access.client?.owner_name || 'Cliente'}</p>
                    <span className={`badge ${statusMeta.cls}`}>{statusMeta.label}</span>
                  </div>
                  <p className="text-xs text-muted break-all">{link}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => handleCopyPortalLink(access)} className="btn btn-secondary btn-sm" disabled={copyingLinkId === access.id}>
                      {copyingLinkId === access.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                      Copiar
                    </button>
                    <a href={link} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                      <ExternalLink size={13} />
                      Abrir
                    </a>
                    <button onClick={() => handlePortalStatus(access, 'paused')} className="btn btn-secondary btn-sm" disabled={saving}>
                      Pausar
                    </button>
                    <button onClick={() => handlePortalStatus(access, 'active')} className="btn btn-secondary btn-sm" disabled={saving}>
                      Ativar
                    </button>
                    <button onClick={() => handlePortalStatus(access, 'revoked')} className="btn btn-danger btn-sm" disabled={saving}>
                      Revogar
                    </button>
                  </div>
                </div>
              )
            })}
            {!portalAccess.length && !loading && (
              <div className="p-6 text-sm text-muted text-center">Nenhum acesso de portal liberado.</div>
            )}
          </div>
        </div>

        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-sky-400" />
            <h2 className="section-title">Solicitacoes recentes (agendamento)</h2>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border2)]">
            {bookingRequests.map((request) => {
              const meta = REQUEST_STATUS_META[request.status] || REQUEST_STATUS_META.pending
              return (
                <div key={request.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text">{request.customer_name}</p>
                      <p className="text-xs text-muted">{request.pet_name || 'Pet nao informado'} - {request.phone || '-'}</p>
                    </div>
                    <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <p className="text-xs text-muted">{request.service_interest || 'Servico nao informado'}</p>
                  <p className="text-xs text-muted">
                    {request.preferred_date ? `${toBRDate(request.preferred_date)} (${request.preferred_period || '-'})` : 'Sem preferencia de data'}
                  </p>
                  <p className="text-xs text-muted">
                    {request.need_motodog ? `MotoDog solicitado (R$ ${Number(request.motodog_fee || 0).toFixed(2)})` : 'Tutor leva ate o PetShop'}
                  </p>
                  {request.need_motodog && (request.pickup_address || request.pickup_neighborhood || request.pickup_city) && (
                    <p className="text-xs text-muted">
                      Endereco: {[request.pickup_address, request.pickup_neighborhood, request.pickup_city].filter(Boolean).join(' - ')}
                    </p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => handleBookingStatus(request, 'contacted')} className="btn btn-secondary btn-sm" disabled={saving}>
                      <Phone size={13} />
                      Contato
                    </button>
                    <button onClick={() => handleBookingStatus(request, 'scheduled')} className="btn btn-secondary btn-sm" disabled={saving}>
                      <CalendarClock size={13} />
                      Agendado
                    </button>
                    <button onClick={() => handlePromoteToLead(request)} className="btn btn-secondary btn-sm" disabled={saving}>
                      <UserPlus size={13} />
                      Virar lead
                    </button>
                    <button onClick={() => handleBookingStatus(request, 'lost')} className="btn btn-danger btn-sm" disabled={saving}>
                      Perdido
                    </button>
                  </div>
                </div>
              )
            })}
            {!bookingRequests.length && !loading && (
              <div className="p-6 text-sm text-muted text-center">Nenhuma solicitacao registrada.</div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="fixed bottom-6 right-6 rounded-full bg-surface border border-[var(--border)] px-4 py-2 text-sm text-muted flex items-center gap-2 shadow-lg">
          <Loader2 size={14} className="animate-spin" />
          Sincronizando painel...
        </div>
      )}
    </div>
  )
}
