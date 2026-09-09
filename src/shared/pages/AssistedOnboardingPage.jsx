import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2, CheckCircle2, CircleAlert, ClipboardCheck, Clock3,
  Plus, RefreshCw, ShieldCheck, Store, Users2, Wrench,
} from 'lucide-react'

import { useAuthCtx } from '../../context/AuthContext'
import {
  createAssistedTenant,
  ensureAssistedAdministrator,
  getAssistedOnboarding,
  listAssistedServices,
  saveAssistedSchedule,
  saveAssistedTeam,
  upsertAssistedService,
} from '../../lib/assistedOnboardingApi'

const DRAFT_KEY = '@yuisync-assisted-onboarding'
const WEEKDAYS = [
  ['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'],
  ['5', 'Sexta'], ['6', 'Sábado'], ['7', 'Domingo'],
]
const EMPTY_ADMIN_FORM = { fullName: '', email: '', password: '' }
const EMPTY_SERVICE_FORM = { name: '', code: '', price: '', duration: '60', group: 'banho_tosa' }
const EMPTY_SCHEDULE_RULES = { slotInterval: '30', leadTime: '15', capacity: '2' }

function initialHours() {
  return Object.fromEntries(WEEKDAYS.map(([key]) => [key, {
    enabled: key !== '7',
    open: '08:00',
    close: '18:00',
  }]))
}

function loadDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function persistDraft(value) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(value))
}

function serviceCode(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function newStaffKey() {
  return `staff-${crypto.randomUUID()}`
}

function StepBadge({ ready }) {
  return ready
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 size={14} /> Concluído</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><CircleAlert size={14} /> Pendente</span>
}

function Section({ icon: Icon, number, title, ready, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white"><Icon size={18} /></span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Etapa {number}</p>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          </div>
        </div>
        <StepBadge ready={ready} />
      </div>
      {children}
    </section>
  )
}

export default function AssistedOnboardingPage() {
  const { tenants: memberTenants = [], managedTenants = [], refreshTenants } = useAuthCtx()
  const tenants = managedTenants.length ? managedTenants : memberTenants
  const draft = useMemo(loadDraft, [])
  const [targetTenantId, setTargetTenantId] = useState(draft.targetTenantId || '')
  const selectedTenantRef = useRef(draft.targetTenantId || '')
  const loadRequestRef = useRef(0)
  const [operationKey, setOperationKey] = useState(draft.operationKey || crypto.randomUUID())
  const [snapshot, setSnapshot] = useState(null)
  const [services, setServices] = useState([])
  const [companyName, setCompanyName] = useState('')
  const [adminForm, setAdminForm] = useState(EMPTY_ADMIN_FORM)
  const [teamRows, setTeamRows] = useState([])
  const [serviceForm, setServiceForm] = useState(EMPTY_SERVICE_FORM)
  const [hours, setHours] = useState(initialHours)
  const [scheduleRules, setScheduleRules] = useState(EMPTY_SCHEDULE_RULES)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const resetTenantDrafts = useCallback(() => {
    loadRequestRef.current += 1
    setSnapshot(null)
    setServices([])
    setAdminForm(EMPTY_ADMIN_FORM)
    setTeamRows([])
    setServiceForm(EMPTY_SERVICE_FORM)
    setHours(initialHours())
    setScheduleRules(EMPTY_SCHEDULE_RULES)
  }, [])

  const loadState = useCallback(async (tenantId) => {
    const selected = String(tenantId || '')
    if (!selected) return
    const requestId = ++loadRequestRef.current
    setBusy('refresh')
    setError('')
    try {
      const [nextSnapshot, nextServices] = await Promise.all([
        getAssistedOnboarding(selected),
        listAssistedServices(selected),
      ])
      if (requestId !== loadRequestRef.current || selectedTenantRef.current !== selected) return

      setSnapshot(nextSnapshot)
      setServices(Array.isArray(nextServices) ? nextServices : [])
      setTeamRows((nextSnapshot.team || []).map((row) => ({
        key: String(row.key || ''),
        name: String(row.name || ''),
        active: row.active !== false,
        persisted: true,
      })))

      const savedHours = nextSnapshot.schedule?.business_hours
      setHours(savedHours
        ? Object.fromEntries(WEEKDAYS.map(([key]) => {
            const row = savedHours[key]?.[0]
            return [key, { enabled: Boolean(row), open: row?.open || '08:00', close: row?.close || '18:00' }]
          }))
        : initialHours())
      setScheduleRules({
        slotInterval: String(nextSnapshot.schedule?.slot_interval_min ?? 30),
        leadTime: String(nextSnapshot.schedule?.booking_lead_time_min ?? 15),
        capacity: String(nextSnapshot.schedule?.booking_capacity ?? 2),
      })
    } catch (loadError) {
      if (requestId !== loadRequestRef.current || selectedTenantRef.current !== selected) return
      setError(loadError.message)
      setSnapshot(null)
      setServices([])
      setTeamRows([])
      setHours(initialHours())
      setScheduleRules(EMPTY_SCHEDULE_RULES)
    } finally {
      if (requestId === loadRequestRef.current && selectedTenantRef.current === selected) setBusy('')
    }
  }, [])

  useEffect(() => {
    if (targetTenantId) loadState(targetTenantId)
  }, [targetTenantId, loadState])

  const setTarget = (tenantId) => {
    const next = String(tenantId || '')
    selectedTenantRef.current = next
    resetTenantDrafts()
    setCompanyName('')
    setTargetTenantId(next)
    setError('')
    setSuccess('')
    persistDraft({ targetTenantId: next, operationKey })
  }

  const snapshotReady = Boolean(
    targetTenantId
    && snapshot?.tenant?.id === targetTenantId
    && selectedTenantRef.current === targetTenantId
    && busy !== 'refresh',
  )

  const requireCurrentSnapshot = () => {
    if (snapshotReady) return true
    setError('Aguarde a empresa selecionada terminar de carregar antes de salvar.')
    return false
  }

  const run = async (key, action, message) => {
    setBusy(key)
    setError('')
    setSuccess('')
    try {
      await action()
      setSuccess(message)
    } catch (actionError) {
      setError(actionError.message)
      throw actionError
    } finally {
      setBusy('')
    }
  }

  const createCompany = async (event) => {
    event.preventDefault()
    const name = companyName.trim()
    if (!name) return setError('Informe o nome da empresa.')
    try {
      await run('company', async () => {
        persistDraft({ targetTenantId: '', operationKey })
        const created = await createAssistedTenant(name, operationKey)
        resetTenantDrafts()
        selectedTenantRef.current = created.id
        setTargetTenantId(created.id)
        persistDraft({ targetTenantId: created.id, operationKey })
        await refreshTenants?.()
        await loadState(created.id)
      }, 'Empresa criada e selecionada para implantação.')
    } catch { /* mensagem já exibida */ }
  }

  const saveAdmin = async (event) => {
    event.preventDefault()
    if (!requireCurrentSnapshot()) return
    try {
      await run('administrator', async () => {
        await ensureAssistedAdministrator({ tenantId: targetTenantId, ...adminForm })
        setAdminForm((current) => ({ ...current, password: '' }))
        await loadState(targetTenantId)
      }, 'Administrador configurado sem duplicar o usuário em reexecuções.')
    } catch { /* mensagem já exibida */ }
  }

  const saveTeam = async (event) => {
    event.preventDefault()
    if (!requireCurrentSnapshot()) return
    const staff = teamRows
      .filter((row) => row.name.trim())
      .map((row) => ({ key: row.key, name: row.name.trim(), active: row.active !== false }))
    try {
      await run('team', async () => {
        await saveAssistedTeam(targetTenantId, staff)
        await loadState(targetTenantId)
      }, 'Equipe operacional salva preservando identidade e status dos colaboradores.')
    } catch { /* mensagem já exibida */ }
  }

  const saveService = async (event) => {
    event.preventDefault()
    if (!requireCurrentSnapshot()) return
    const name = serviceForm.name.trim()
    const code = serviceForm.code.trim() || serviceCode(name)
    try {
      await run('catalog', async () => {
        await upsertAssistedService(targetTenantId, {
          code,
          name,
          group_type: serviceForm.group,
          default_price: Number(String(serviceForm.price).replace(',', '.')),
          default_duration_min: Number(serviceForm.duration),
          commission_type: 'percentage',
          commission_rate: 0,
          active: true,
        })
        setServiceForm(EMPTY_SERVICE_FORM)
        await loadState(targetTenantId)
      }, 'Serviço salvo pelo catálogo nativo. Repetir o mesmo código atualiza em vez de duplicar.')
    } catch { /* mensagem já exibida */ }
  }

  const saveSchedule = async (event) => {
    event.preventDefault()
    if (!requireCurrentSnapshot()) return
    const businessHours = Object.fromEntries(WEEKDAYS.map(([key]) => [
      key,
      hours[key].enabled ? [{ open: hours[key].open, close: hours[key].close }] : [],
    ]))
    try {
      await run('schedule', async () => {
        await saveAssistedSchedule(targetTenantId, {
          business_hours: businessHours,
          slot_interval_min: Number(scheduleRules.slotInterval),
          booking_lead_time_min: Number(scheduleRules.leadTime),
          booking_capacity: Number(scheduleRules.capacity),
        })
        await loadState(targetTenantId)
      }, 'Horários e regras operacionais salvos.')
    } catch { /* mensagem já exibida */ }
  }

  const startNew = () => {
    const nextOperationKey = crypto.randomUUID()
    resetTenantDrafts()
    selectedTenantRef.current = ''
    setOperationKey(nextOperationKey)
    setTargetTenantId('')
    setCompanyName('')
    setSuccess('')
    setError('')
    persistDraft({ targetTenantId: '', operationKey: nextOperationKey })
  }

  const steps = snapshot?.steps || {}

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Gestão central</p>
          <h1 className="text-2xl font-bold text-slate-950">Implantação assistida</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Empresa → administrador → equipe → catálogo → horários/regras → revisão. O progresso é calculado a partir dos dados realmente persistidos.
          </p>
        </div>
        <div className="flex gap-2">
          {targetTenantId && (
            <button type="button" onClick={() => loadState(targetTenantId)} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={16} className={busy === 'refresh' ? 'animate-spin' : ''} /> Atualizar
            </button>
          )}
          <button type="button" onClick={startNew} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Nova implantação</button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}

      {!targetTenantId ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={Building2} number="1" title="Empresa" ready={false}>
            <form onSubmit={createCompany} className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">Nome da empresa
                <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Ex.: Pet Center Centro" />
              </label>
              <button disabled={busy === 'company'} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <Plus size={16} /> Criar empresa
              </button>
            </form>
          </Section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-3"><Store size={20} /><h2 className="font-semibold text-slate-900">Retomar implantação</h2></div>
            <p className="mb-3 text-sm text-slate-600">Selecione uma empresa à qual sua conta já tenha acesso administrativo.</p>
            <select value="" onChange={(event) => setTarget(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="">Selecione uma empresa</option>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </section>
        </div>
      ) : (
        <div className="space-y-5">
          <Section icon={Building2} number="1" title="Empresa" ready={Boolean(steps.company)}>
            <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3">
              <div><span className="text-slate-500">Nome</span><p className="font-medium">{snapshot?.tenant?.name || 'Carregando...'}</p></div>
              <div><span className="text-slate-500">ID</span><p className="break-all font-mono text-xs">{targetTenantId}</p></div>
              <div><span className="text-slate-500">Slug</span><p className="font-mono text-xs">{snapshot?.tenant?.slug || '—'}</p></div>
            </div>
          </Section>

          <Section icon={ShieldCheck} number="2" title="Administrador com login" ready={Boolean(steps.administrator)}>
            {snapshot?.administrators?.length > 0 && (
              <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {snapshot.administrators.map((admin) => <div key={admin.id}><strong>{admin.name}</strong>{admin.email ? ` · ${admin.email}` : ''}</div>)}
              </div>
            )}
            <form onSubmit={saveAdmin} className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-medium text-slate-700">Nome
                <input required value={adminForm.fullName} onChange={(event) => setAdminForm({ ...adminForm, fullName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-medium text-slate-700">E-mail
                <input required type="email" value={adminForm.email} onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-medium text-slate-700">Senha temporária
                <input required type="password" minLength={12} value={adminForm.password} onChange={(event) => setAdminForm({ ...adminForm, password: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="12+ caracteres, A/a/0" />
              </label>
              <div className="md:col-span-3"><button disabled={Boolean(busy) || !snapshotReady} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar administrador</button></div>
            </form>
          </Section>

          <Section icon={Users2} number="3" title="Equipe operacional" ready={Boolean(steps.team)}>
            <p className="mb-3 text-sm text-slate-600">Cada colaborador mantém uma chave estável. Renomear não altera identidade; desativar preserva vínculos históricos.</p>
            <form onSubmit={saveTeam} className="space-y-3">
              <div className="space-y-2">
                {teamRows.map((row, index) => (
                  <div key={row.key} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <label className="text-sm font-medium text-slate-700">Nome
                      <input
                        required={row.persisted}
                        value={row.name}
                        onChange={(event) => setTeamRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(event) => setTeamRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))}
                      /> Ativo
                    </label>
                    {!row.persisted && (
                      <button type="button" onClick={() => setTeamRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Remover</button>
                    )}
                    <p className="break-all font-mono text-[11px] text-slate-400 md:col-span-3">{row.key}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setTeamRows((current) => [...current, { key: newStaffKey(), name: '', active: true, persisted: false }])} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"><Plus size={15} /> Adicionar colaborador</button>
                <button disabled={Boolean(busy) || !snapshotReady || teamRows.length === 0} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar equipe</button>
              </div>
            </form>
          </Section>

          <Section icon={Wrench} number="4" title="Catálogo de serviços" ready={Boolean(steps.catalog)}>
            {services.length > 0 && (
              <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2">Serviço</th><th className="px-3 py-2">Código</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Duração</th></tr></thead>
                  <tbody>{services.slice(0, 30).map((service) => <tr key={service.id} className="border-t border-slate-100"><td className="px-3 py-2">{service.name}</td><td className="px-3 py-2 font-mono text-xs">{service.code}</td><td className="px-3 py-2">R$ {Number(service.default_price || 0).toFixed(2)}</td><td className="px-3 py-2">{service.default_duration_min} min</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <form onSubmit={saveService} className="grid gap-3 md:grid-cols-5">
              <label className="text-sm font-medium text-slate-700 md:col-span-2">Nome
                <input required value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-medium text-slate-700">Código
                <input value={serviceForm.code} onChange={(event) => setServiceForm({ ...serviceForm, code: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="automático" />
              </label>
              <label className="text-sm font-medium text-slate-700">Valor
                <input required inputMode="decimal" value={serviceForm.price} onChange={(event) => setServiceForm({ ...serviceForm, price: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="50,00" />
              </label>
              <label className="text-sm font-medium text-slate-700">Duração (min)
                <input required type="number" min="1" max="1440" value={serviceForm.duration} onChange={(event) => setServiceForm({ ...serviceForm, duration: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-medium text-slate-700 md:col-span-2">Grupo
                <select value={serviceForm.group} onChange={(event) => setServiceForm({ ...serviceForm, group: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="banho_tosa">Banho e tosa</option><option value="veterinaria">Veterinária</option><option value="motoboy">Entrega/MotoDog</option><option value="outro">Outro</option></select>
              </label>
              <div className="flex items-end md:col-span-3"><button disabled={Boolean(busy) || !snapshotReady} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Adicionar ou atualizar serviço</button></div>
            </form>
          </Section>

          <Section icon={Clock3} number="5" title="Horários e regras" ready={Boolean(steps.schedule)}>
            <form onSubmit={saveSchedule} className="space-y-4">
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {WEEKDAYS.map(([key, label]) => (
                  <div key={key} className="rounded-lg border border-slate-200 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={hours[key].enabled} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], enabled: event.target.checked } })} /> {label}</label>
                    <div className="mt-2 flex gap-2"><input type="time" disabled={!hours[key].enabled} value={hours[key].open} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], open: event.target.value } })} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5" /><input type="time" disabled={!hours[key].enabled} value={hours[key].close} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], close: event.target.value } })} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5" /></div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm font-medium text-slate-700">Intervalo dos slots (min)<input type="number" min="5" max="240" value={scheduleRules.slotInterval} onChange={(event) => setScheduleRules({ ...scheduleRules, slotInterval: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Antecedência mínima (min)<input type="number" min="0" max="10080" value={scheduleRules.leadTime} onChange={(event) => setScheduleRules({ ...scheduleRules, leadTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Capacidade por horário<input type="number" min="1" max="50" value={scheduleRules.capacity} onChange={(event) => setScheduleRules({ ...scheduleRules, capacity: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              </div>
              <button disabled={Boolean(busy) || !snapshotReady} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar horários e regras</button>
            </form>
          </Section>

          <Section icon={ClipboardCheck} number="6" title="Revisão" ready={Boolean(snapshot?.review_ready)}>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ['Empresa', steps.company], ['Administrador', steps.administrator], ['Equipe operacional', steps.team],
                ['Catálogo', steps.catalog], ['Horários e regras', steps.schedule],
              ].map(([label, ready]) => <div key={label} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>{label}</span><StepBadge ready={Boolean(ready)} /></div>)}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>Cobrança SaaS</strong><p className="mt-1">Nenhuma assinatura comercial é criada ou cobrada automaticamente por este fluxo.</p></div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>WhatsApp</strong><p className="mt-1">Este fluxo não considera a integração funcional por haver credenciais. O status permanece não verificado até prova operacional específica.</p></div>
            </div>
            {snapshot?.review_ready ? <p className="mt-4 text-sm font-medium text-emerald-700">Implantação pronta para revisão humana final.</p> : <p className="mt-4 text-sm text-amber-800">Pendências reais: {(snapshot?.pending || []).join(', ') || 'carregando...'}</p>}
          </Section>
        </div>
      )}
    </div>
  )
}
