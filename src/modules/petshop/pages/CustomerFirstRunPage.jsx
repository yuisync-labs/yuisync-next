import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Check, Clock3, LifeBuoy, Plus, Rocket, Store, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useAuthCtx } from '../../../context/AuthContext'
import {
  getAppSettings,
  getCustomerFirstRun,
  patchAppSettings,
  patchCustomerFirstRun,
} from '../../../lib/api'
import {
  getAssistedOnboarding,
  listAssistedServices,
  saveAssistedSchedule,
  saveAssistedTeam,
  upsertAssistedService,
} from '../../../lib/assistedOnboardingApi'

const WEEKDAYS = [
  ['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta'], ['6', 'Sábado'], ['7', 'Domingo'],
]

function defaultHours() {
  return Object.fromEntries(WEEKDAYS.map(([key]) => [key, {
    enabled: Number(key) <= 6,
    open: '08:00',
    close: key === '6' ? '13:00' : '18:00',
  }]))
}

function hoursFromSnapshot(snapshot) {
  const saved = snapshot?.schedule?.business_hours
  if (!saved) return defaultHours()
  return Object.fromEntries(WEEKDAYS.map(([key]) => {
    const row = saved[key]?.[0]
    return [key, { enabled: Boolean(row), open: row?.open || '08:00', close: row?.close || '18:00' }]
  }))
}

function Card({ icon: Icon, number, title, description, done, children }) {
  return (
    <section className="rounded-2xl border border-[var(--border2)] bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--primary-bg-light)] text-[var(--primary)]'}`}>
          {done ? <Check size={18} /> : <Icon size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Etapa {number}</p>
          <h2 className="mt-1 text-lg font-black text-text">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-5 border-t border-[var(--border2)] pt-5">{children}</div>
    </section>
  )
}

const field = 'mt-1.5 min-h-11 w-full rounded-lg border border-[var(--border2)] bg-bg px-3 text-sm text-text outline-none focus:border-[var(--primary)]'

export default function CustomerFirstRunPage() {
  const navigate = useNavigate()
  const { activeTenantId, profile, updateStoreSettings, refreshSettings } = useAuthCtx()
  const [snapshot, setSnapshot] = useState(null)
  const [progress, setProgress] = useState(null)
  const [services, setServices] = useState([])
  const [company, setCompany] = useState({ business_name: '', business_phone: '', business_email: '', business_address: '', business_tax_id: '' })
  const [hours, setHours] = useState(defaultHours)
  const [team, setTeam] = useState([])
  const [service, setService] = useState({ name: '', price: '', duration: '60', group: 'outro' })
  const [availability, setAvailability] = useState('')
  const [busy, setBusy] = useState('load')
  const [notice, setNotice] = useState(null)

  const load = useCallback(async ({ preserveNotice = false } = {}) => {
    if (!activeTenantId) return
    setBusy('load')
    if (!preserveNotice) setNotice(null)
    try {
      const [nextSnapshot, nextProgress, nextServices, settings] = await Promise.all([
        getAssistedOnboarding(activeTenantId),
        getCustomerFirstRun(activeTenantId),
        listAssistedServices(activeTenantId),
        getAppSettings({ tenantId: activeTenantId, moduleId: 'petshop' }),
      ])
      setSnapshot(nextSnapshot)
      setProgress(nextProgress)
      setServices(nextServices)
      setHours(hoursFromSnapshot(nextSnapshot))
      setTeam(nextSnapshot.team?.length ? nextSnapshot.team : [{ key: crypto.randomUUID(), name: profile?.full_name || '', active: true }])
      const row = settings.settings || {}
      setCompany({
        business_name: row.business_name || nextSnapshot.tenant?.name || '',
        business_phone: row.business_phone || '',
        business_email: row.business_email || profile?.email || '',
        business_address: row.business_address || '',
        business_tax_id: row.business_tax_id || '',
      })
      setAvailability(nextProgress.support?.availability || '')
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Não foi possível carregar a primeira configuração.' })
    } finally {
      setBusy('')
    }
  }, [activeTenantId, profile?.email, profile?.full_name])

  useEffect(() => { load() }, [load])

  const completed = useMemo(() => new Set(progress?.completedSteps || []), [progress])

  async function run(key, action, success) {
    setBusy(key)
    setNotice(null)
    try {
      await action()
      await load({ preserveNotice: true })
      setNotice({ type: 'success', text: success })
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Não foi possível salvar.' })
      setBusy('')
    }
  }

  function mark(step, next) {
    return patchCustomerFirstRun(activeTenantId, { completedStep: step, currentStep: next })
  }

  function saveCompany(event) {
    event.preventDefault()
    run('company', async () => {
      await patchAppSettings({ tenantId: activeTenantId, moduleId: 'petshop', patch: company })
      updateStoreSettings(company)
      await refreshSettings?.('petshop')
      await mark('empresa', 'horarios')
    }, 'Dados da empresa salvos.')
  }

  function saveSchedule(event) {
    event.preventDefault()
    const businessHours = Object.fromEntries(WEEKDAYS.map(([key]) => [key, hours[key].enabled ? [{ open: hours[key].open, close: hours[key].close }] : []]))
    run('schedule', async () => {
      await saveAssistedSchedule(activeTenantId, {
        business_hours: businessHours,
        slot_interval_min: 30,
        booking_lead_time_min: 15,
        booking_capacity: 2,
      })
      await mark('horarios', 'servicos')
    }, 'Horários de atendimento salvos.')
  }

  function saveService(event) {
    event.preventDefault()
    run('service', async () => {
      const normalizedPrice = Number(String(service.price).replace(',', '.'))
      const normalizedDuration = Number(service.duration)
      if (!service.name.trim() || !Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
        throw new Error('Informe um nome e um preço válido para o serviço.')
      }
      if (!Number.isInteger(normalizedDuration) || normalizedDuration < 5 || normalizedDuration > 1440) {
        throw new Error('Informe uma duração válida entre 5 e 1440 minutos.')
      }
      const normalizedCode = service.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await upsertAssistedService(activeTenantId, {
        code: `primeiro-${normalizedCode || crypto.randomUUID().slice(0, 8)}`,
        name: service.name.trim(),
        group_type: service.group,
        default_price: normalizedPrice,
        default_duration_min: normalizedDuration,
        commission_type: 'percentage',
        commission_rate: 0,
        active: true,
      })
      setService({ name: '', price: '', duration: '60', group: 'outro' })
      await mark('servicos', 'equipe')
    }, 'Primeiro serviço criado.')
  }

  function saveTeam(event) {
    event.preventDefault()
    const staff = team.filter((row) => row.name.trim()).map((row) => ({ ...row, name: row.name.trim() }))
    run('team', async () => {
      await saveAssistedTeam(activeTenantId, staff)
      await mark('equipe', 'tour')
    }, staff.length ? 'Equipe inicial salva.' : 'Você poderá adicionar a equipe mais tarde.')
  }

  function saveSupport(event) {
    event.preventDefault()
    run('support', async () => {
      await patchCustomerFirstRun(activeTenantId, { supportAvailability: availability, completedStep: 'suporte', currentStep: 'tour' })
    }, 'Solicitação enviada. A equipe YuiSync confirmará o horário pelo seu contato.')
  }

  function finish() {
    setBusy('finish')
    setNotice(null)
    patchCustomerFirstRun(activeTenantId, { completedStep: 'tour', currentStep: 'concluido', complete: true })
      .then(() => {
        navigate('/petshop/dashboard', { replace: true })
      })
      .catch((error) => {
        setNotice({ type: 'error', text: error.message || 'Não foi possível concluir a configuração.' })
        setBusy('')
      })
  }

  if (busy === 'load' && !snapshot) return <div className="grid min-h-[60vh] place-items-center text-sm text-muted">Preparando sua primeira configuração…</div>

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pb-16 md:p-7">
      <header className="rounded-2xl bg-[#0B0B0C] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Primeira configuração</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">Prepare sua operação.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">Configure o necessário para abrir a agenda. Você pode sair e continuar depois.</p></div>
          <div className="rounded-xl bg-white/10 px-4 py-3 text-sm"><strong>{completed.size}</strong> etapas salvas</div>
        </div>
      </header>

      {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>{notice.text}</div>}

      <Card icon={Store} number="1" title="Sua empresa" description="Esses dados aparecem no sistema e nos comprovantes." done={completed.has('empresa')}>
        <form onSubmit={saveCompany} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-text">Nome da empresa<input required value={company.business_name} onChange={(event) => setCompany({ ...company, business_name: event.target.value })} className={field} /></label>
          <label className="text-sm font-semibold text-text">Telefone<input value={company.business_phone} onChange={(event) => setCompany({ ...company, business_phone: event.target.value })} className={field} /></label>
          <label className="text-sm font-semibold text-text">E-mail<input type="email" value={company.business_email} onChange={(event) => setCompany({ ...company, business_email: event.target.value })} className={field} /></label>
          <label className="text-sm font-semibold text-text">CPF ou CNPJ<input value={company.business_tax_id} onChange={(event) => setCompany({ ...company, business_tax_id: event.target.value })} className={field} /></label>
          <label className="text-sm font-semibold text-text sm:col-span-2">Endereço<input value={company.business_address} onChange={(event) => setCompany({ ...company, business_address: event.target.value })} className={field} /></label>
          <button disabled={Boolean(busy)} className="btn btn-primary sm:col-span-2 sm:w-fit">Salvar e continuar <ArrowRight size={15} /></button>
        </form>
      </Card>

      <Card icon={Clock3} number="2" title="Horários" description="Defina quando a agenda deve aceitar atendimentos." done={completed.has('horarios') || progress?.readiness?.schedule}>
        <form onSubmit={saveSchedule} className="space-y-3">
          {WEEKDAYS.map(([key, label]) => <div key={key} className="grid items-center gap-3 rounded-xl border border-[var(--border2)] p-3 sm:grid-cols-[130px_1fr_1fr]">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={hours[key].enabled} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], enabled: event.target.checked } })} /> {label}</label>
            <input type="time" disabled={!hours[key].enabled} value={hours[key].open} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], open: event.target.value } })} className={field.replace('mt-1.5 ', '')} />
            <input type="time" disabled={!hours[key].enabled} value={hours[key].close} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], close: event.target.value } })} className={field.replace('mt-1.5 ', '')} />
          </div>)}
          <button disabled={Boolean(busy)} className="btn btn-primary">Salvar horários <ArrowRight size={15} /></button>
        </form>
      </Card>

      <Card icon={CalendarDays} number="3" title="Primeiro serviço" description="Crie ao menos um serviço para começar a usar a agenda." done={completed.has('servicos') || services.length > 0}>
        {services.length > 0 && <p className="mb-4 text-sm text-emerald-700">{services.length} serviço(s) ativo(s) no catálogo.</p>}
        <form onSubmit={saveService} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">Nome<input required value={service.name} onChange={(event) => setService({ ...service, name: event.target.value })} placeholder="Ex.: Banho" className={field} /></label>
          <label className="text-sm font-semibold">Preço<input required inputMode="decimal" value={service.price} onChange={(event) => setService({ ...service, price: event.target.value })} placeholder="65,00" className={field} /></label>
          <label className="text-sm font-semibold">Duração em minutos<input required type="number" min="5" max="1440" value={service.duration} onChange={(event) => setService({ ...service, duration: event.target.value })} className={field} /></label>
          <label className="text-sm font-semibold">Tipo<select value={service.group} onChange={(event) => setService({ ...service, group: event.target.value })} className={field}><option value="banho_tosa">Banho ou tosa</option><option value="outro">Outro serviço</option></select></label>
          <button disabled={Boolean(busy)} className="btn btn-primary sm:col-span-2 sm:w-fit"><Plus size={15} /> Criar serviço</button>
        </form>
      </Card>

      <Card icon={Users} number="4" title="Equipe" description="Inclua quem executa os atendimentos. Esta etapa pode ser concluída mais tarde." done={completed.has('equipe') || snapshot?.steps?.team}>
        <form onSubmit={saveTeam} className="space-y-3">
          {team.map((row, index) => <div key={row.key} className="flex gap-2"><input value={row.name} onChange={(event) => setTeam(team.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} placeholder="Nome do profissional" className={field.replace('mt-1.5 ', '')} /><button type="button" onClick={() => setTeam(team.filter((_, position) => position !== index))} className="btn btn-ghost">Remover</button></div>)}
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setTeam([...team, { key: crypto.randomUUID(), name: '', active: true }])} className="btn btn-secondary"><Plus size={15} /> Adicionar pessoa</button><button disabled={Boolean(busy)} className="btn btn-primary">Salvar equipe</button></div>
        </form>
      </Card>

      <Card icon={LifeBuoy} number="5" title="Sessão de implantação" description="Seu plano inclui uma sessão individual de até 60 minutos com a equipe YuiSync." done={progress?.support?.status !== 'not_requested'}>
        <form onSubmit={saveSupport} className="space-y-3"><label className="text-sm font-semibold">Informe dois horários possíveis<textarea required minLength={3} value={availability} onChange={(event) => setAvailability(event.target.value)} className={`${field} min-h-24 py-3`} placeholder="Ex.: terça às 15h ou quinta às 10h" /></label><button disabled={Boolean(busy)} className="btn btn-primary">Solicitar sessão</button></form>
      </Card>

      <Card icon={Rocket} number="6" title="Conheça o essencial" description="Abra cada área quando quiser. O checklist continuará disponível neste menu." done={progress?.status === 'completed'}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[['Agenda', '/petshop/agenda'], ['Clientes e pets', '/petshop/pets'], ['Vendas e caixa', '/petshop/vendas'], ['Configurações', '/petshop/config'], ['Conectar WhatsApp', '/petshop/meta-whatsapp']].map(([label, href]) => <button key={href} type="button" onClick={() => navigate(href)} className="rounded-xl border border-[var(--border2)] p-4 text-left text-sm font-bold text-text transition-colors hover:bg-bg">{label} <ArrowRight className="mt-3" size={15} /></button>)}
        </div>
        <button type="button" onClick={finish} disabled={Boolean(busy) || !progress?.canComplete} className="btn btn-primary mt-5"><Check size={16} /> Concluir primeira configuração</button>
        {!progress?.canComplete && <p className="mt-3 text-xs text-muted">Para concluir, salve os dados da empresa, os horários e ao menos um serviço.</p>}
      </Card>
    </div>
  )
}
