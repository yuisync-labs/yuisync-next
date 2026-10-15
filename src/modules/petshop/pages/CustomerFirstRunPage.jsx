import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, CalendarClock, Check, PawPrint, Rocket } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Card, CardContent, CardFooter, CardHeader, StatusBadge } from '../../../components/ui'
import { useAuthCtx } from '../../../context/AuthContext'
import { planDefinition } from '../../../config/planEntitlements'
import { getAppSettings, getCustomerFirstRun, patchAppSettings, patchCustomerFirstRun } from '../../../lib/api'
import {
  getAssistedOnboarding,
  listAssistedServices,
  saveAssistedSchedule,
  upsertAssistedService,
} from '../../../lib/assistedOnboardingApi'
import { CompanyLogoField } from '../onboarding/CompanyLogoField'
import { ModuleUnlockPreview } from '../onboarding/ModuleUnlockPreview'
import { OnboardingStepper } from '../onboarding/OnboardingStepper'
import {
  readVisualPreviewFirstRun,
  writeVisualPreviewFirstRun,
} from '../onboarding/visualPreviewFirstRun'

const STEPS = ['Empresa', 'Operação', 'Módulos', 'Concluir']
const WEEKDAYS = [
  ['1', 'Segunda'], ['2', 'Terça'], ['3', 'Quarta'], ['4', 'Quinta'], ['5', 'Sexta'], ['6', 'Sábado'], ['7', 'Domingo'],
]
const SERVICE_TYPES = [
  { id: 'banho-tosa', label: 'Banho & Tosa', group: 'banho_tosa', duration: 90 },
  { id: 'consultas', label: 'Consultas', group: 'outro', duration: 45 },
  { id: 'vacinas', label: 'Vacinas', group: 'outro', duration: 30 },
  { id: 'hotelzinho', label: 'Hotelzinho', group: 'outro', duration: 1440 },
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

function initialWizardStep(progress) {
  if (progress?.status === 'completed') return 4
  if (progress?.currentStep === 'horarios' || progress?.currentStep === 'servicos') return 2
  if (['equipe', 'suporte', 'tour'].includes(progress?.currentStep)) return 3
  return 1
}

function serviceCode(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function CustomerFirstRunPage() {
  const navigate = useNavigate()
  const auth = useAuthCtx()
  const { activeTenantId, activeTenant, activePlanSlug, activePlanModules, profile, updateStoreSettings, refreshSettings, refreshTenants, visualPreview } = auth
  const [wizardStep, setWizardStep] = useState(1)
  const [maxAccessibleStep, setMaxAccessibleStep] = useState(1)
  const [snapshot, setSnapshot] = useState(null)
  const [progress, setProgress] = useState(null)
  const [company, setCompany] = useState({ business_name: '', business_tax_id: '', logo_url: '' })
  const [hours, setHours] = useState(defaultHours)
  const [selectedServices, setSelectedServices] = useState(['banho-tosa'])
  const [busy, setBusy] = useState('load')
  const [notice, setNotice] = useState(null)

  const load = useCallback(async ({ keepStep = false, preserveNotice = false } = {}) => {
    if (!activeTenantId) return
    setBusy('load')
    if (!preserveNotice) setNotice(null)
    try {
      if (visualPreview) {
        const draft = readVisualPreviewFirstRun({
          tenantName: activeTenant?.name || 'Ambiente de demonstração',
          hours: defaultHours(),
          selectedServices: ['banho-tosa'],
        })
        setSnapshot({ tenant: { name: draft.company.business_name }, schedule: { business_hours: {} } })
        setProgress(draft.progress)
        setCompany(draft.company)
        setHours(draft.hours)
        setSelectedServices(draft.selectedServices)
        setMaxAccessibleStep((current) => Math.max(current, draft.wizardStep))
        if (!keepStep) setWizardStep(draft.wizardStep)
        return
      }

      const [nextSnapshot, nextProgress, services, settings] = await Promise.all([
        getAssistedOnboarding(activeTenantId),
        getCustomerFirstRun(activeTenantId),
        listAssistedServices(activeTenantId),
        getAppSettings({ tenantId: activeTenantId, moduleId: 'petshop' }),
      ])
      const row = settings.settings || {}
      setSnapshot(nextSnapshot)
      setProgress(nextProgress)
      setHours(hoursFromSnapshot(nextSnapshot))
      setCompany({
        business_name: row.business_name || nextSnapshot.tenant?.name || '',
        business_tax_id: row.business_tax_id || '',
        logo_url: row.logo_url || '',
      })
      const names = new Set((services || []).map((service) => serviceCode(service.name)))
      const matched = SERVICE_TYPES.filter((service) => names.has(serviceCode(service.label))).map((service) => service.id)
      if (matched.length) setSelectedServices(matched)
      const nextStep = initialWizardStep(nextProgress)
      setMaxAccessibleStep((current) => Math.max(current, nextStep))
      if (!keepStep) setWizardStep(nextStep)
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Não foi possível carregar a configuração.' })
    } finally {
      setBusy('')
    }
  }, [activeTenant?.name, activeTenantId, visualPreview])

  useEffect(() => { load() }, [load])

  const plan = useMemo(() => {
    const slug = progress?.planSlug || progress?.plan_slug || activeTenant?.plan_slug || activePlanSlug
    const definition = planDefinition(slug)
    const modules = progress?.allowedModules || progress?.allowed_modules || activePlanModules
    if (definition) return { ...definition, modules: Array.isArray(modules) && modules.length ? modules : definition.modules }
    return { slug: 'legacy', name: 'Plano atual', modules: Array.isArray(modules) ? modules : [] }
  }, [activePlanModules, activePlanSlug, activeTenant?.plan_slug, progress])

  async function run(key, action, success) {
    setBusy(key)
    setNotice(null)
    try {
      await action()
      setNotice(success ? { type: 'success', text: success } : null)
      return true
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Não foi possível salvar esta etapa.' })
      return false
    } finally {
      setBusy('')
    }
  }

  async function saveCompany(event) {
    event.preventDefault()
    if (visualPreview) {
      const nextProgress = {
        ...(progress || {}),
        status: 'in_progress',
        currentStep: 'horarios',
        completedSteps: [...new Set([...(progress?.completedSteps || []), 'empresa'])],
      }
      const saved = await run('company', async () => {
        writeVisualPreviewFirstRun({
          ...readVisualPreviewFirstRun({ hours: defaultHours() }),
          wizardStep: 2,
          company,
          hours,
          selectedServices,
          progress: nextProgress,
        })
        updateStoreSettings(company)
        setProgress(nextProgress)
      }, 'Identidade salva neste navegador.')
      if (saved) {
        setMaxAccessibleStep((current) => Math.max(current, 2))
        setWizardStep(2)
      }
      return
    }

    const saved = await run('company', async () => {
      await patchAppSettings({ tenantId: activeTenantId, moduleId: 'petshop', patch: company })
      updateStoreSettings(company)
      await refreshSettings?.('petshop')
      await patchCustomerFirstRun(activeTenantId, { completedStep: 'empresa', currentStep: 'horarios' })
    }, 'Identidade salva.')
    if (saved) {
      setMaxAccessibleStep((current) => Math.max(current, 2))
      setWizardStep(2)
      await load({ keepStep: true, preserveNotice: true })
    }
  }

  async function saveOperations(event) {
    event.preventDefault()
    const enabledDays = WEEKDAYS.filter(([key]) => hours[key].enabled)
    if (enabledDays.length === 0) {
      setNotice({ type: 'error', text: 'Ative ao menos um dia de funcionamento.' })
      return
    }
    if (selectedServices.length === 0) {
      setNotice({ type: 'error', text: 'Selecione ao menos um tipo de serviço.' })
      return
    }
    if (visualPreview) {
      const nextProgress = {
        ...(progress || {}),
        status: 'in_progress',
        currentStep: 'tour',
        completedSteps: [...new Set([...(progress?.completedSteps || []), 'empresa', 'horarios', 'servicos'])],
        canComplete: true,
      }
      const saved = await run('operations', async () => {
        writeVisualPreviewFirstRun({
          ...readVisualPreviewFirstRun({ hours: defaultHours() }),
          wizardStep: 3,
          company,
          hours,
          selectedServices,
          progress: nextProgress,
        })
        setProgress(nextProgress)
      }, 'Operação salva neste navegador.')
      if (saved) {
        setMaxAccessibleStep((current) => Math.max(current, 3))
        setWizardStep(3)
      }
      return
    }

    const saved = await run('operations', async () => {
      const businessHours = Object.fromEntries(WEEKDAYS.map(([key]) => [key, hours[key].enabled ? [{ open: hours[key].open, close: hours[key].close }] : []]))
      await saveAssistedSchedule(activeTenantId, {
        business_hours: businessHours,
        slot_interval_min: 30,
        booking_lead_time_min: 15,
        booking_capacity: 2,
      })
      await patchCustomerFirstRun(activeTenantId, { completedStep: 'horarios', currentStep: 'servicos' })
      await Promise.all(SERVICE_TYPES.filter((service) => selectedServices.includes(service.id)).map((service) => upsertAssistedService(activeTenantId, {
        code: `onboarding-${service.id}`,
        name: service.label,
        group_type: service.group,
        default_price: 0,
        default_duration_min: service.duration,
        commission_type: 'percentage',
        commission_rate: 0,
        active: true,
      })))
      await patchCustomerFirstRun(activeTenantId, { completedStep: 'servicos', currentStep: 'tour' })
    }, 'Operação básica configurada.')
    if (saved) {
      setMaxAccessibleStep((current) => Math.max(current, 3))
      setWizardStep(3)
      await load({ keepStep: true, preserveNotice: true })
    }
  }

  async function continueFromModules() {
    if (visualPreview) {
      const nextProgress = { ...(progress || {}), currentStep: 'tour', canComplete: true }
      const saved = await run('modules', async () => {
        writeVisualPreviewFirstRun({
          ...readVisualPreviewFirstRun({ hours: defaultHours() }),
          wizardStep: 4,
          company,
          hours,
          selectedServices,
          progress: nextProgress,
        })
        setProgress(nextProgress)
      }, '')
      if (saved) {
        setMaxAccessibleStep((current) => Math.max(current, 4))
        setWizardStep(4)
      }
      return
    }

    const saved = await run('modules', () => patchCustomerFirstRun(activeTenantId, { currentStep: 'tour' }), '')
    if (saved) {
      setMaxAccessibleStep((current) => Math.max(current, 4))
      setWizardStep(4)
    }
  }

  async function finish() {
    if (visualPreview) {
      const nextProgress = {
        ...(progress || {}),
        status: 'completed',
        currentStep: 'concluido',
        canComplete: true,
      }
      const saved = await run('finish', async () => {
        writeVisualPreviewFirstRun({
          ...readVisualPreviewFirstRun({ hours: defaultHours() }),
          wizardStep: 4,
          company,
          hours,
          selectedServices,
          progress: nextProgress,
        })
        setProgress(nextProgress)
      }, '')
      if (saved) navigate('/petshop/dashboard', { replace: true })
      return
    }

    const saved = await run('finish', async () => {
      await patchCustomerFirstRun(activeTenantId, { completedStep: 'tour', currentStep: 'concluido', complete: true })
      await refreshTenants?.()
    }, '')
    if (saved) navigate('/petshop/dashboard', { replace: true })
  }

  if (busy === 'load' && !snapshot) return <div className="grid min-h-[60vh] place-items-center text-sm text-muted">Preparando sua empresa…</div>

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-16 md:p-7">
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><StatusBadge variant="info">{plan.name}</StatusBadge><span className="text-xs font-semibold text-muted">Configuração inicial</span></div>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-text sm:text-4xl">Vamos preparar sua operação.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Leva poucos minutos. Seu progresso fica salvo e os módulos são liberados conforme o plano confirmado no checkout.</p>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--primary-bg-light)] text-[var(--primary)]"><Rocket size={21} /></div>
        </div>
        <OnboardingStepper currentStep={wizardStep} maxAccessibleStep={maxAccessibleStep} onStepChange={setWizardStep} steps={STEPS} />
      </header>

      {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${notice.type === 'error' ? 'border-[var(--ui-danger-border)] bg-[var(--ui-danger-bg)] text-[var(--ui-danger-fg)]' : 'border-[var(--ui-success-border)] bg-[var(--ui-success-bg)] text-[var(--ui-success-fg)]'}`}>{notice.text}</div>}

      {wizardStep === 1 && (
        <Card as="section">
          <CardHeader><div className="flex items-center gap-3"><Building2 size={19} className="text-[var(--primary)]" /><div><h2 className="font-black text-text">Identidade da empresa</h2><p className="mt-1 text-sm text-muted">Como seu Pet Shop ou Clínica aparecerá no YuiSync.</p></div></div></CardHeader>
          <form onSubmit={saveCompany}>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <label><span className="inp-label">Nome do Pet Shop / Clínica</span><input required maxLength={160} className="inp mt-2" value={company.business_name} onChange={(event) => setCompany({ ...company, business_name: event.target.value })} placeholder="Ex.: QuatroPatas PetVet" /></label>
              <label><span className="inp-label">CNPJ ou CPF do responsável</span><input required maxLength={64} className="inp mt-2" value={company.business_tax_id} onChange={(event) => setCompany({ ...company, business_tax_id: event.target.value })} placeholder="00.000.000/0001-00" /></label>
              <div className="sm:col-span-2"><CompanyLogoField name={company.business_name} value={company.logo_url} disabled={Boolean(busy)} onChange={(logo_url) => setCompany({ ...company, logo_url })} /></div>
            </CardContent>
            <CardFooter className="flex justify-end"><button disabled={Boolean(busy)} className="btn btn-primary">{busy === 'company' ? 'Salvando…' : 'Salvar e continuar'} <ArrowRight size={15} /></button></CardFooter>
          </form>
        </Card>
      )}

      {wizardStep === 2 && (
        <Card as="section">
          <CardHeader><div className="flex items-center gap-3"><CalendarClock size={19} className="text-[var(--primary)]" /><div><h2 className="font-black text-text">Configurações operacionais</h2><p className="mt-1 text-sm text-muted">Defina horários e os serviços disponíveis no primeiro acesso.</p></div></div></CardHeader>
          <form onSubmit={saveOperations}>
            <CardContent className="space-y-6">
              <fieldset><legend className="text-sm font-bold text-text">Horário de funcionamento</legend><div className="mt-3 space-y-2">{WEEKDAYS.map(([key, label]) => <div key={key} className="grid items-center gap-3 border-b border-[var(--border2)] py-3 sm:grid-cols-[150px_1fr_1fr]"><label className="flex items-center gap-2 text-sm font-semibold text-text"><input type="checkbox" checked={hours[key].enabled} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], enabled: event.target.checked } })} /> {label}</label><input aria-label={`Abertura de ${label}`} type="time" disabled={!hours[key].enabled} value={hours[key].open} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], open: event.target.value } })} className="inp" /><input aria-label={`Fechamento de ${label}`} type="time" disabled={!hours[key].enabled} value={hours[key].close} onChange={(event) => setHours({ ...hours, [key]: { ...hours[key], close: event.target.value } })} className="inp" /></div>)}</div></fieldset>
              <fieldset><legend className="text-sm font-bold text-text">Serviços oferecidos</legend><p className="mt-1 text-xs text-muted">Você poderá ajustar duração e preço depois.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{SERVICE_TYPES.map((service) => { const selected = selectedServices.includes(service.id); return <button key={service.id} type="button" aria-pressed={selected} onClick={() => setSelectedServices((current) => selected ? current.filter((id) => id !== service.id) : [...current, service.id])} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-bold transition-colors ${selected ? 'border-[var(--primary)] bg-[var(--primary-bg-light)] text-[var(--primary)]' : 'border-[var(--border2)] bg-surface text-text hover:border-[var(--ui-border-hover)]'}`}><span className="grid h-7 w-7 place-items-center rounded-full border border-current">{selected ? <Check size={14} /> : <PawPrint size={13} />}</span>{service.label}</button> })}</div></fieldset>
            </CardContent>
            <CardFooter className="flex flex-wrap justify-between gap-3"><button type="button" className="btn btn-ghost" onClick={() => setWizardStep(1)}><ArrowLeft size={15} /> Voltar</button><button disabled={Boolean(busy)} className="btn btn-primary">{busy === 'operations' ? 'Salvando…' : 'Salvar e continuar'} <ArrowRight size={15} /></button></CardFooter>
          </form>
        </Card>
      )}

      {wizardStep === 3 && (
        <section className="space-y-5">
          <ModuleUnlockPreview plan={plan} onConnectWhatsapp={() => window.open('/petshop/meta-whatsapp', '_blank', 'noopener,noreferrer')} />
          <div className="flex flex-wrap justify-between gap-3"><button type="button" className="btn btn-ghost" onClick={() => setWizardStep(2)}><ArrowLeft size={15} /> Voltar</button><button type="button" disabled={Boolean(busy)} className="btn btn-primary" onClick={continueFromModules}>Continuar <ArrowRight size={15} /></button></div>
        </section>
      )}

      {wizardStep === 4 && (
        <Card as="section" tone="success">
          <CardContent className="py-10 text-center sm:px-10">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--ui-success-bg)] text-[var(--ui-success-fg)]"><Check size={25} /></span>
            <h2 className="mt-5 text-2xl font-black text-text">Tudo pronto para começar.</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">A empresa {company.business_name || activeTenant?.name} está configurada. A Dashboard abrirá somente os recursos liberados no {plan.name}.</p>
            {!progress?.canComplete && <p role="alert" className="mt-4 text-sm font-semibold text-[var(--ui-warning-fg)]">Ainda estamos validando os dados obrigatórios. Volte à etapa de operação e salve novamente se necessário.</p>}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3"><button type="button" className="btn btn-ghost" onClick={() => setWizardStep(3)}><ArrowLeft size={15} /> Voltar</button><button type="button" disabled={Boolean(busy) || !progress?.canComplete} className="btn btn-primary" onClick={finish}>{busy === 'finish' ? 'Liberando…' : 'Acessar minha Dashboard'} <ArrowRight size={15} /></button></CardFooter>
        </Card>
      )}

      <p className="text-center text-xs text-muted">{visualPreview ? 'Demonstração local · Progresso salvo neste navegador' : `Conectado como ${profile?.email || 'administrador'} · Progresso salvo na sua empresa`}</p>
    </div>
  )
}
