import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DateTime } from 'luxon'
import {
  Ban,
  Bike,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  PackageCheck,
  PawPrint,
  PencilLine,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'

import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { fmtCurrency } from '../../../lib/supabase'
import { useClients } from '../../../shared/hooks/useClients'
import { groupPetsByTutor } from '../../../shared/lib/petTutorGroups'
import { useCatalogPlans } from '../hooks/useCatalogPlans'
import {
  cancelSubscriptionCommand,
  loadPackageAppointmentsCommand,
  publishPackageScheduleHint,
  reschedulePackageAppointmentCommand,
  updateSubscriptionUsageCommand,
} from '../lib/planCommands'
import { usePetshopAdvanced, BILLING_CYCLES } from '../hooks/usePetshopAdvanced'
import {
  MOTODOG_PLAN_SERVICE,
  buildCatalogUsageSummary,
  catalogServiceMap,
  isRealCatalogPlanService,
  normalizeCatalogPlanServices,
  planEntryForCatalogService,
  planServiceLabel,
} from '../lib/catalogPlanServices'
import {
  buildEditableUsage,
  clampSubscriptionUsage,
  normalizeSubscriptionSearch,
  subscriptionMatchesSearch,
} from '../lib/subscriptionUsageAdmin'

const PACKAGE_FIRST_APPOINTMENT_STORAGE_KEY = 'yuisync:package-first-appointment-at'

function enrichPlanServices(services, catalogServices) {
  const catalog = catalogServiceMap(catalogServices)
  return normalizeCatalogPlanServices(services).map((service) => {
    const realService = catalog.get(service.service_code || service.service_type)
    if (!realService) return service
    return {
      ...service,
      service_type: realService.code,
      service_code: realService.code,
      service_name: realService.name,
      service_kind: 'catalog',
      group_type: realService.group_type || service.group_type,
    }
  })
}

function nextAvailableEntry(currentServices, catalogServices) {
  const used = new Set(currentServices.map((service) => service.service_type))
  const firstCatalog = catalogServices.find((service) => !used.has(service.code))
  if (firstCatalog) return planEntryForCatalogService(firstCatalog, 1)
  if (!used.has('motodog')) return { ...MOTODOG_PLAN_SERVICE }
  return null
}

function clientSearchText(client = {}) {
  return normalizeSubscriptionSearch([
    client.owner_name,
    client.pet_name,
    client.phone,
    client.email,
    client.breed,
  ].filter(Boolean).join(' '))
}

function clientMatches(client, query) {
  const terms = normalizeSubscriptionSearch(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  const haystack = clientSearchText(client)
  return terms.every((term) => haystack.includes(term))
}

function subscriptionIsCompleted(subscription = {}) {
  if (subscription.status !== 'active') return false
  const usage = buildEditableUsage(subscription)
  return usage.length > 0 && usage.every((item) => (
    item.total > 0
    && item.used >= item.total
    && item.reserved === 0
  ))
}

function effectiveSubscriptionStatus(subscription = {}) {
  return subscriptionIsCompleted(subscription) ? 'completed' : subscription.status
}

function statusMeta(status) {
  return {
    active: { label: 'Ativo', cls: 'badge-green' },
    completed: { label: 'Concluído', cls: 'badge-blue' },
    paused: { label: 'Pausado', cls: 'badge-gray' },
    cancelled: { label: 'Cancelado', cls: 'badge-red' },
    pending_payment: { label: 'Aguardando pagamento', cls: 'badge-amber' },
  }[status] || { label: status || 'Indefinido', cls: 'badge-gray' }
}

const PETSHOP_ZONE = 'America/Sao_Paulo'

function asPetshopDateTime(value) {
  if (value instanceof Date) return DateTime.fromJSDate(value).setZone(PETSHOP_ZONE)
  const raw = String(value || '')
  if (!raw) return DateTime.invalid('empty')
  const parsed = DateTime.fromISO(raw, { setZone: true })
  return parsed.isValid ? parsed.setZone(PETSHOP_ZONE) : DateTime.invalid('invalid')
}

function localDateValue(value) {
  const date = asPetshopDateTime(value)
  return date.isValid ? date.toISODate() : ''
}

function renewalStartDate(subscription = {}, pendingSubscription = null) {
  if (pendingSubscription?.started_at) return localDateValue(pendingSubscription.started_at)
  if (subscription.next_billing_date) return String(subscription.next_billing_date).slice(0, 10)
  const started = asPetshopDateTime(subscription.started_at)
  if (started.isValid) return started.plus({ days: 28 }).toISODate()
  return DateTime.now().setZone(PETSHOP_ZONE).toISODate()
}

function appointmentInputParts(value) {
  const date = asPetshopDateTime(value)
  if (!date.isValid) return { date: '', time: '' }
  return { date: date.toISODate(), time: date.toFormat('HH:mm') }
}

function appointmentDateTimeIso(dateValue, timeValue) {
  if (!dateValue || !timeValue) return ''
  const date = DateTime.fromISO(`${dateValue}T${timeValue}:00`, { zone: PETSHOP_ZONE })
  return date.isValid ? date.toUTC().toISO() : ''
}

function packageAppointmentServiceLabel(appointment = {}) {
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  return items.map((item) => item?.name).filter(Boolean).join(' + ')
    || appointment.service_type
    || 'Serviço do pacote'
}

function packageAppointmentStatus(status) {
  return {
    agendado: { label: 'Agendado', cls: 'badge-amber' },
    confirmado: { label: 'Confirmado', cls: 'badge-blue' },
    em_andamento: { label: 'Em andamento', cls: 'badge-purple' },
    concluido: { label: 'Concluído', cls: 'badge-green' },
    cancelado: { label: 'Cancelado', cls: 'badge-red' },
    no_show: { label: 'No-show', cls: 'badge-gray' },
  }[status] || { label: status || 'Indefinido', cls: 'badge-gray' }
}

function PlanModal({ plan, catalogServices, onClose, onSave }) {
  const catalog = useMemo(() => catalogServiceMap(catalogServices), [catalogServices])
  const [form, setForm] = useState(() => {
    const existing = enrichPlanServices(plan?.services || [], catalogServices)
    const fallback = existing.length
      ? existing
      : [planEntryForCatalogService(catalogServices[0], 4)].filter(Boolean)
    return {
      name: plan?.name || '',
      price: plan?.price || 0,
      billing_cycle: plan?.billing_cycle || 'monthly',
      active: plan?.active !== false,
      services: fallback,
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  function updateServiceType(index, serviceType) {
    setForm((current) => ({
      ...current,
      services: current.services.map((service, serviceIndex) => {
        if (serviceIndex !== index) return service
        const qty = Math.max(1, Number(service.qty_per_cycle || 1))
        if (serviceType === 'motodog') return { ...MOTODOG_PLAN_SERVICE, qty_per_cycle: qty }
        return planEntryForCatalogService(catalog.get(serviceType), qty) || service
      }),
    }))
  }

  function updateQuantity(index, quantity) {
    setForm((current) => ({
      ...current,
      services: current.services.map((service, serviceIndex) => (
        serviceIndex === index
          ? { ...service, qty_per_cycle: Math.max(1, Number(quantity || 1)) }
          : service
      )),
    }))
  }

  function addService() {
    setForm((current) => {
      const entry = nextAvailableEntry(current.services, catalogServices)
      return entry ? { ...current, services: [...current.services, entry] } : current
    })
  }

  async function submit() {
    const services = enrichPlanServices(form.services, catalogServices)
    const legacy = services.filter((service) => (
      service.service_kind === 'catalog'
      && !isRealCatalogPlanService(service, catalogServices)
    ))
    if (!form.name.trim()) return setError('Informe o nome de identificação do pacote.')
    if (!services.length) return setError('Adicione pelo menos um serviço real ou MotoDog.')
    if (legacy.length) return setError('Associe todos os itens legados a serviços reais do catálogo antes de salvar.')
    if (new Set(services.map((service) => service.service_type)).size !== services.length) {
      return setError('O mesmo serviço não pode aparecer duas vezes no pacote.')
    }

    setSaving(true)
    setError('')
    try {
      await onSave({ id: plan?.id, ...form, services })
      onClose()
    } catch (submitError) {
      setError(submitError?.message || 'Não foi possível salvar o pacote.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-3xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">{plan ? 'Editar pacote' : 'Novo pacote'}</h2>
            <p className="mt-1 text-sm text-muted">Selecione os serviços reais que serão consumidos na Agenda.</p>
          </div>
          <button type="button" aria-label="Fechar pacote" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>

        <div className="modal-body space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="inp-label">Nome de identificação</label>
              <input className="inp" value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: Pacote Banho Básico"/>
            </div>
            <div>
              <label className="inp-label">Preço do pacote</label>
              <input className="inp" type="number" min="0" step="0.01" value={form.price} onChange={(event) => set('price', event.target.value)}/>
            </div>
            <div>
              <label className="inp-label">Ciclo</label>
              <select className="inp" value={form.billing_cycle} onChange={(event) => set('billing_cycle', event.target.value)}>
                {Object.entries(BILLING_CYCLES).map(([value, metadata]) => <option key={value} value={value}>{metadata.label}</option>)}
              </select>
            </div>
            <label className="mt-7 flex items-center gap-3 text-sm text-text">
              <input type="checkbox" checked={form.active} onChange={(event) => set('active', event.target.checked)}/>
              Pacote disponível para novas vendas
            </label>
          </div>

          <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-text">Serviços incluídos</p>
                <p className="mt-1 text-xs text-muted">Cada item usa o código real do catálogo e possui um limite por ciclo.</p>
              </div>
              <button type="button" onClick={addService} className="btn btn-secondary btn-sm"><Plus size={13}/> Adicionar serviço</button>
            </div>

            <div className="space-y-3">
              {form.services.map((service, index) => {
                const legacy = service.service_kind === 'catalog' && !catalog.has(service.service_type)
                return (
                  <div key={`${service.service_type}-${index}`} className={`rounded-xl border p-3 ${legacy ? 'border-amber-500/35 bg-amber-500/8' : 'border-[var(--border2)] bg-surface/70'}`}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_120px_44px]">
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted">Serviço real</label>
                        <select className="inp" value={service.service_type} onChange={(event) => updateServiceType(index, event.target.value)}>
                          {legacy && <option value={service.service_type}>Legado: {service.service_name || service.service_type}</option>}
                          <optgroup label="Catálogo de serviços">
                            {catalogServices.map((catalogService) => (
                              <option key={catalogService.code} value={catalogService.code}>{catalogService.name} · {fmtCurrency(catalogService.default_price || 0)}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Transporte"><option value="motodog">MotoDog - buscar e levar</option></optgroup>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted">Por ciclo</label>
                        <input className="inp" type="number" min="1" step="1" value={service.qty_per_cycle} onChange={(event) => updateQuantity(index, event.target.value)}/>
                      </div>
                      <button type="button" title="Remover serviço" onClick={() => setForm((current) => ({ ...current, services: current.services.filter((_, itemIndex) => itemIndex !== index) }))} className="btn btn-danger btn-sm mt-5 justify-center"><Trash2 size={13}/></button>
                    </div>
                    {legacy && <p className="mt-2 text-xs text-amber-300">Item legado: selecione um serviço real antes de salvar.</p>}
                  </div>
                )
              })}
            </div>
          </section>

          {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="button" onClick={submit} disabled={saving} className="btn btn-primary flex-1 justify-center"><Save size={15}/> {saving ? 'Salvando...' : 'Salvar pacote'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ClientPicker({ clients, selectedId, onSelect, onManagePets }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pendingTutorPets, setPendingTutorPets] = useState([])
  const selected = clients.find((client) => client.id === selectedId)
  const results = useMemo(() => groupPetsByTutor(clients)
    .filter((group) => group.pets.some((client) => clientMatches(client, search)))
    .slice(0, 20), [clients, search])

  const selectTutor = (group) => {
    if (group.pets.length === 1) {
      onSelect(group.pets[0].id)
      setOpen(false)
      setSearch('')
      return
    }
    setPendingTutorPets(group.pets)
    setSearch('')
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inp-label mb-0">Pet que receberá o pacote</label>
        {onManagePets && <button type="button" onClick={onManagePets} className="btn btn-ghost btn-sm"><PawPrint size={13}/> Gerenciar clientes e pets</button>}
      </div>
      <p className="mb-2 mt-1 text-xs text-muted">Cada venda fica vinculada ao pet escolhido, mesmo quando o tutor possui vários pets.</p>
      {!open && selected ? (
        <button type="button" onClick={() => { setPendingTutorPets([]); setOpen(true) }} className="w-full rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-left">
          <span className="block font-bold text-text">{selected.pet_name || 'Pet não informado'}</span>
          <span className="mt-1 block text-xs text-muted">{selected.owner_name || 'Tutor não informado'}{selected.phone ? ` · ${selected.phone}` : ''}</span>
        </button>
      ) : !open ? (
        <button type="button" onClick={() => { setPendingTutorPets([]); setOpen(true) }} className="btn btn-secondary w-full justify-center"><Search size={14}/> Pesquisar tutor ou pet</button>
      ) : (
        <div className="rounded-xl border border-[var(--border2)] bg-surface p-3 shadow-xl">
          {pendingTutorPets.length > 1 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-text">Escolha qual pet receberá o pacote</p>
                  <p className="text-xs text-muted">{pendingTutorPets[0]?.owner_name} possui {pendingTutorPets.length} pets ativos.</p>
                </div>
                <button type="button" onClick={() => setPendingTutorPets([])} className="btn btn-ghost btn-sm">Voltar</button>
              </div>
              {pendingTutorPets.map((pet) => (
                <button key={pet.id} type="button" onClick={() => { onSelect(pet.id); setOpen(false); setPendingTutorPets([]) }} className="w-full rounded-xl border border-[var(--border2)] px-3 py-2.5 text-left hover:bg-emerald-500/10">
                  <span className="block text-sm font-bold text-text">{pet.pet_name || 'Pet não informado'}</span>
                  <span className="block text-xs text-muted">{pet.breed || pet.species || 'Espécie não informada'}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"/>
                <input autoFocus className="inp pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite tutor, pet ou telefone..."/>
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--border2)]">
                {results.map((group) => (
                  <button key={group.key} type="button" onClick={() => selectTutor(group)} className="flex w-full items-center justify-between gap-3 border-b border-[var(--border2)] px-3 py-2.5 text-left last:border-0 hover:bg-white/5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-text">{group.owner_name || 'Tutor não informado'}</span>
                      <span className="block truncate text-xs text-muted">{group.pets.length === 1 ? group.pets[0].pet_name || 'Pet não informado' : `${group.pets.length} pets: ${group.pets.map((pet) => pet.pet_name).filter(Boolean).join(', ')}`}</span>
                    </span>
                    {group.pets.length > 1 ? <span className="text-[10px] font-bold text-emerald-400">Escolher pet</span> : selectedId === group.pets[0]?.id && <CheckCircle2 size={15} className="shrink-0 text-emerald-400"/>}
                  </button>
                ))}
                {!results.length && <p className="px-3 py-4 text-center text-sm text-muted">Nenhum cliente encontrado.</p>}
              </div>
            </>
          )}
          <button type="button" onClick={() => { setOpen(false); setSearch(''); setPendingTutorPets([]) }} className="btn btn-ghost btn-sm mt-2 w-full justify-center">Fechar busca</button>
        </div>
      )}
    </div>
  )
}

function SubscriptionModal({ plans, clients, catalogServices, context, onClose, onSave, onManagePets }) {
  const renewalOf = context?.renewalOf || null
  const pendingSubscription = context?.pendingSubscription || null
  const renewal = Boolean(renewalOf)
  const fixedPlanId = pendingSubscription?.plan_id || renewalOf?.plan_id || ''
  const fixedClientId = pendingSubscription?.client_id || renewalOf?.client_id || ''
  const [form, setForm] = useState(() => ({
    id: pendingSubscription?.id,
    plan_id: fixedPlanId || plans[0]?.id || '',
    client_id: fixedClientId,
    status: pendingSubscription ? 'pending_payment' : 'active',
    started_at: renewal
      ? renewalStartDate(renewalOf, pendingSubscription)
      : localDateValue(new Date()),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedPlan = plans.find((plan) => plan.id === form.plan_id)
  const selectedClient = clients.find((client) => client.id === form.client_id)

  async function submit() {
    if (!form.client_id) return setError('Selecione o pet que receberá o pacote.')
    setSaving(true)
    setError('')
    try {
      await onSave({ ...form, plan: selectedPlan, billing_cycle: selectedPlan?.billing_cycle })
      onClose()
    } catch (submitError) {
      setError(submitError?.message || 'Não foi possível iniciar a venda do pacote.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Vender pacote ao cliente</h2>
            <p className="mt-1 text-sm text-muted">{renewal ? 'Revise a primeira data e o horário antes de gerar ou abrir o pagamento da renovação.' : 'A assinatura só ficará ativa depois da confirmação do pagamento.'}</p>
          </div>
          <button type="button" aria-label="Fechar assinatura" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>

        <div className="modal-body space-y-5">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {renewal
              ? pendingSubscription
                ? 'Esta renovação já está aguardando pagamento. Informe a agenda que faltou para liberar o recebimento.'
                : 'A renovação só será enviada para pagamento depois que a primeira data e o horário do novo ciclo forem informados.'
              : 'Ao continuar, o pacote irá para Ordens / Entrega → Banho & Tosa. Os benefícios serão liberados somente após o recebimento no caixa.'}
          </div>
          <div>
            <label className="inp-label">Pacote</label>
            <select className="inp" disabled={renewal} value={form.plan_id} onChange={(event) => setForm((current) => ({ ...current, plan_id: event.target.value }))}>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} - {fmtCurrency(plan.price)}</option>)}
            </select>
          </div>
          {renewal ? (
            <div>
              <label className="inp-label">Pet que receberá a renovação</label>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
                <span className="block font-bold text-text">{selectedClient?.pet_name || renewalOf?.client?.pet_name || 'Pet não informado'}</span>
                <span className="mt-1 block text-xs text-muted">{selectedClient?.owner_name || renewalOf?.client?.owner_name || 'Tutor não informado'}</span>
              </div>
            </div>
          ) : (
            <ClientPicker clients={clients} selectedId={form.client_id} onSelect={(clientId) => setForm((current) => ({ ...current, client_id: clientId }))} onManagePets={onManagePets}/>
          )}
          <div>
            <label className="inp-label">{renewal ? 'Primeiro atendimento do novo ciclo' : 'Início previsto do ciclo'}</label>
            <input className="inp" type="date" value={form.started_at} onChange={(event) => setForm((current) => ({ ...current, started_at: event.target.value }))}/>
          </div>

          {selectedPlan && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">Cobertura do pacote</p>
                <strong className="text-emerald-300">{fmtCurrency(selectedPlan.price)}</strong>
              </div>
              <div className="mt-3 space-y-2">
                {selectedPlan.services.map((service) => (
                  <div key={service.service_type} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-text">{planServiceLabel(service, catalogServices)}</span>
                    <span className="shrink-0 font-semibold text-emerald-400">{service.qty_per_cycle}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="button" onClick={submit} disabled={saving || !plans.length} className="btn btn-primary flex-1 justify-center"><CreditCard size={15}/> {saving ? 'Preparando...' : pendingSubscription ? 'Salvar agenda e abrir pagamento' : 'Continuar para pagamento'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PackageAppointmentsModal({ subscription, activeTenantId, moduleId, onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadAppointments() {
    setLoading(true)
    setError('')
    try {
      const appointments = await loadPackageAppointmentsCommand({
        tenantId: activeTenantId,
        moduleId,
        subscriptionId: subscription.id,
      })
      setRows(appointments.map((appointment) => ({
        ...appointment,
        ...appointmentInputParts(appointment.scheduled_at),
        original_scheduled_at: appointment.scheduled_at,
      })))
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar os agendamentos do pacote.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAppointments()
  }, [subscription.id])

  function updateRow(id, key, value) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row))
  }

  async function saveAppointments() {
    const normalized = rows.map((row) => ({
      ...row,
      next_scheduled_at: appointmentDateTimeIso(row.date, row.time),
    }))
    const invalid = normalized.find((row) => !row.next_scheduled_at)
    if (invalid) {
      setError('Preencha data e horário em todos os agendamentos do pacote.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      for (const row of normalized) {
        const before = new Date(row.original_scheduled_at || '').getTime()
        const after = new Date(row.next_scheduled_at || '').getTime()
        if (Number.isFinite(before) && Number.isFinite(after) && before === after) continue

        await reschedulePackageAppointmentCommand({
          tenantId: activeTenantId,
          moduleId,
          appointmentId: row.id,
          scheduledAt: row.next_scheduled_at,
          source: row.source || 'package_activation',
        })
      }

      const firstAt = normalized
        .map((row) => row.next_scheduled_at || row.original_scheduled_at)
        .filter(Boolean)
        .sort((left, right) => new Date(left) - new Date(right))[0]

      if (firstAt) publishPackageScheduleHint({ subscriptionId: subscription.id, firstAppointmentAt: firstAt })

      await loadAppointments()
      await onChanged?.()
      setNotice('Datas do pacote atualizadas com sucesso.')
    } catch (saveError) {
      const code = String(saveError?.code || '')
      const message = String(saveError?.message || '')
      setError(code === 'APPOINTMENT_UPDATE_UNAVAILABLE'
        ? 'A infraestrutura de edição da Agenda ainda não está disponível.'
        : message || 'Não foi possível atualizar os agendamentos do pacote.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-4xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Agendamentos do pacote</h2>
            <p className="mt-1 text-sm text-muted">{subscription.client?.pet_name || subscription.client?.owner_name} · {subscription.subscription_plans?.name}</p>
          </div>
          <button type="button" aria-label="Fechar agendamentos" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>

        <div className="modal-body space-y-4">
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            Todos os agendamentos vinculados ao ciclo são exibidos, incluindo datas futuras e passadas. Qualquer data e horário pode ser ajustado manualmente para controle operacional.
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted"><RefreshCw size={15} className="animate-spin"/> Carregando agendamentos...</div>
          ) : (
            <div className="space-y-3">
              {rows.map((row, index) => {
                const metadata = packageAppointmentStatus(row.status)
                return (
                  <div key={row.id} className="rounded-2xl border border-[var(--border2)] bg-surface/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Atendimento {index + 1}</p>
                        <p className="mt-1 font-semibold text-text">{packageAppointmentServiceLabel(row)}</p>
                      </div>
                      <span className={`badge ${metadata.cls}`}>{metadata.label}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="inp-label">Data</label>
                        <input type="date" className="inp" value={row.date} onChange={(event) => updateRow(row.id, 'date', event.target.value)}/>
                      </div>
                      <div>
                        <label className="inp-label">Horário</label>
                        <input type="time" className="inp" value={row.time} onChange={(event) => updateRow(row.id, 'time', event.target.value)}/>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-muted">Data e horário disponíveis para conferência ou ajuste manual, independentemente do status.</p>
                  </div>
                )
              })}
              {!rows.length && <p className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-5 text-center text-sm text-amber-200">Nenhum agendamento vinculado foi encontrado para este ciclo.</p>}
            </div>
          )}

          {notice && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}
          {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Fechar</button>
            <button type="button" onClick={saveAppointments} disabled={saving || loading || rows.length === 0} className="btn btn-primary flex-1 justify-center"><Save size={15}/> {saving ? 'Salvando...' : 'Salvar datas'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function UsageEditModal({ subscription, onClose, onSave }) {
  const items = useMemo(() => buildEditableUsage(subscription), [subscription])
  const [values, setValues] = useState(() => Object.fromEntries(items.map((item) => [item.service_type, item.used])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setSaving(true)
    setError('')
    try {
      await onSave(subscription, values)
      onClose()
    } catch (submitError) {
      setError(submitError?.message || 'Não foi possível salvar o consumo.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Editar consumo do pacote</h2>
            <p className="mt-1 text-sm text-muted">{subscription.client?.pet_name || subscription.client?.owner_name} · {subscription.subscription_plans?.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-4">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <p className="flex items-start gap-2"><ShieldAlert size={16} className="mt-0.5 shrink-0"/> Reduzir o consumo libera saldo para novos agendamentos. O histórico dos atendimentos não é apagado.</p>
          </div>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.service_type} className="grid grid-cols-[minmax(0,1fr)_120px] items-end gap-3 rounded-xl border border-[var(--border2)] bg-surface/70 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-text">{item.service_name}</p>
                  <p className="mt-1 text-xs text-muted">Limite contratado: {item.total} por ciclo</p>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted">Utilizados</label>
                  <input className="inp" type="number" min="0" max={item.total} step="1" value={values[item.service_type] ?? 0} onChange={(event) => setValues((current) => ({ ...current, [item.service_type]: event.target.value }))}/>
                </div>
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="button" disabled={saving || !items.length} onClick={submit} className="btn btn-primary flex-1 justify-center"><Save size={15}/> {saving ? 'Salvando...' : 'Salvar consumo'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CancelSubscriptionModal({ subscription, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setSaving(true)
    setError('')
    try {
      await onConfirm(subscription)
      onClose()
    } catch (submitError) {
      setError(submitError?.message || 'Não foi possível cancelar a assinatura.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-md">
        <div className="modal-header">
          <h2 className="font-display text-xl font-bold text-text">Cancelar assinatura</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-4">
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            O pacote de <strong>{subscription.client?.pet_name || subscription.client?.owner_name}</strong> deixará de aparecer na Agenda. O histórico e os consumos atuais serão preservados.
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Voltar</button>
            <button type="button" disabled={saving} onClick={confirm} className="btn btn-danger flex-1 justify-center"><Ban size={15}/> {saving ? 'Cancelando...' : 'Confirmar cancelamento'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function PlanosNativePage({ setPage }) {
  const { activeTenantId } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const { clients, load: loadClients } = useClients()
  const { loadPetshopServices } = usePetshopAdvanced()
  const { loadPlans, savePlan, loadSubscriptions, saveSubscription } = useCatalogPlans()
  const moduleId = activeModuleId || 'petshop'
  const [plans, setPlans] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [catalogServices, setCatalogServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [planModal, setPlanModal] = useState(null)
  const [subscriptionModal, setSubscriptionModal] = useState(null)
  const [editingUsage, setEditingUsage] = useState(null)
  const [managingAppointments, setManagingAppointments] = useState(null)
  const [cancelling, setCancelling] = useState(null)

  const activeSubscriptions = subscriptions.filter((subscription) => (
    subscription.status === 'active' && !subscriptionIsCompleted(subscription)
  ))
  const activeByPlan = useMemo(() => activeSubscriptions.reduce((map, subscription) => {
    map[subscription.plan_id] = (map[subscription.plan_id] || 0) + 1
    return map
  }, {}), [activeSubscriptions])
  const filteredSubscriptions = useMemo(
    () => subscriptions.filter((subscription) => subscriptionMatchesSearch({
      ...subscription,
      status: effectiveSubscriptionStatus(subscription),
    }, search)),
    [subscriptions, search],
  )
  const renewalsToday = subscriptions.filter((subscription) => (
    !subscriptionIsCompleted(subscription)
    && subscription.next_billing_date === DateTime.now().setZone(PETSHOP_ZONE).toISODate()
  )).length

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [planRows, subscriptionRows, catalogRows] = await Promise.all([
        loadPlans(),
        loadSubscriptions(),
        loadPetshopServices(),
      ])
      setCatalogServices(catalogRows || [])
      setPlans((planRows || []).map((plan) => ({ ...plan, services: enrichPlanServices(plan.services, catalogRows || []) })))
      setSubscriptions(subscriptionRows || [])
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar os pacotes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadClients()
    void reload()
  }, [])

  async function handleSavePlan(payload) {
    await savePlan(payload)
    await reload()
  }

  function focusSubscriptionPayment(subscriptionId) {
    window.sessionStorage.setItem('yuisync:orders-tab', 'banho_tosa')
    window.sessionStorage.setItem('yuisync:subscription-focus', subscriptionId)
    setPage?.('ordens')
  }

  async function persistPendingSchedule(subscription) {
    if (subscription?.status !== 'pending_payment') return subscription
    const firstAt = window.sessionStorage.getItem(PACKAGE_FIRST_APPOINTMENT_STORAGE_KEY)
    if (firstAt) publishPackageScheduleHint({ subscriptionId: subscription.id, firstAppointmentAt: firstAt })
    return subscription
  }

  async function handleSaveSubscription(payload) {
    let subscription = await saveSubscription(payload)
    subscription = await persistPendingSchedule(subscription)
    await reload()
    if (subscription?.status === 'pending_payment') {
      focusSubscriptionPayment(subscription.id)
    }
  }

  function renewSubscription(subscription) {
    if (!activeTenantId) {
      setError('Selecione uma empresa ativa antes de renovar o pacote.')
      return
    }
    if (!subscriptionIsCompleted(subscription)) {
      setError('Este pacote ainda possui serviços disponíveis e não pode ser renovado como concluído.')
      return
    }
    if (subscription.subscription_plans?.active === false) {
      setError('Este pacote foi desativado. Reative o pacote antes de renovar.')
      return
    }

    const pendingRenewal = subscriptions.find((candidate) => (
      candidate.id !== subscription.id
      && candidate.plan_id === subscription.plan_id
      && candidate.client_id === subscription.client_id
      && candidate.status === 'pending_payment'
    ))
    if (pendingRenewal) {
      focusSubscriptionPayment(pendingRenewal.id)
      return
    }

    setError('')
    setSubscriptionModal({
      renewalOf: subscription,
      pendingSubscription: pendingRenewal || null,
    })
  }

  async function saveUsage(subscription, requested) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de editar o consumo.')
    const servicesUsed = clampSubscriptionUsage(subscription, requested)
    await updateSubscriptionUsageCommand({ tenantId: activeTenantId, moduleId, subscriptionId: subscription.id, servicesUsed })
    await reload()
  }

  async function cancelSubscription(subscription) {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de cancelar.')
    await cancelSubscriptionCommand({ tenantId: activeTenantId, moduleId, subscriptionId: subscription.id })
    await reload()
  }

  return (
    <div className="page animate-fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2"><CreditCard size={22} className="text-emerald-400"/> Planos de Assinatura</h1>
          <p className="page-sub">Venda, ativação, consumo, conclusão e renovação dos pacotes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reload} className="btn btn-secondary"><RefreshCw size={15}/> Atualizar</button>
          <button type="button" onClick={() => setPage?.('pets')} className="btn btn-secondary"><PawPrint size={15}/> Clientes & Pets</button>
          <button type="button" onClick={() => setSubscriptionModal({})} className="btn btn-secondary"><Repeat2 size={15}/> Vender pacote</button>
          <button type="button" onClick={() => setPlanModal({})} className="btn btn-primary"><Plus size={15}/> Novo pacote</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-card p-5"><p className="text-xs font-bold uppercase tracking-widest text-muted">Pacotes ativos</p><p className="mt-2 font-display text-3xl font-bold text-emerald-400">{plans.filter((plan) => plan.active).length}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-card p-5"><p className="text-xs font-bold uppercase tracking-widest text-muted">Assinaturas ativas</p><p className="mt-2 font-display text-3xl font-bold text-text">{activeSubscriptions.length}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-card p-5"><p className="text-xs font-bold uppercase tracking-widest text-muted">Renovação hoje</p><p className="mt-2 font-display text-3xl font-bold text-amber-400">{renewalsToday}</p></div>
      </div>

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-text"><PackageCheck size={16} className="text-emerald-400"/> Fluxo financeiro do pacote</p>
        <p className="mt-1 text-sm text-muted">Ao consumir todos os serviços do ciclo, o pacote fica concluído. A renovação solicita a nova agenda antes de abrir a cobrança e preserva o ciclo anterior no histórico.</p>
      </div>

      {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full py-12 text-center text-sm text-muted">Carregando pacotes...</div>
        ) : plans.map((plan) => {
          const hasMotoDog = plan.services.some((service) => service.service_type === 'motodog')
          const hasLegacy = plan.services.some((service) => service.service_kind === 'catalog' && !isRealCatalogPlanService(service, catalogServices))
          return (
            <button key={plan.id} type="button" onClick={() => setPlanModal(plan)} className={`rounded-2xl border bg-card p-5 text-left transition-all hover:-translate-y-1 ${hasLegacy ? 'border-amber-500/35' : hasMotoDog ? 'border-sky-400/35' : 'border-[var(--border)] hover:border-emerald-400/30'}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-display text-xl font-bold text-text">{plan.name}</p><p className="mt-1 text-xs text-muted">{BILLING_CYCLES[plan.billing_cycle]?.label || plan.billing_cycle}</p></div>
                <div className="flex flex-col items-end gap-2"><span className={`badge ${plan.active ? 'badge-green' : 'badge-gray'}`}>{plan.active ? 'Ativo' : 'Pausado'}</span>{hasLegacy && <span className="badge badge-amber">Revisar legado</span>}</div>
              </div>
              <p className="mt-5 font-display text-3xl font-bold text-emerald-400">{fmtCurrency(plan.price)}</p>
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-surface/80 px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-widest text-muted">Clientes ativos</p><p className="mt-1 text-lg font-semibold text-text">{activeByPlan[plan.id] || 0}</p></div>
              <div className="mt-5 space-y-2 border-t border-[var(--border2)] pt-4">
                {plan.services.map((service) => <div key={`${plan.id}-${service.service_type}`} className="flex items-start justify-between gap-3 text-sm"><span className="text-text">{planServiceLabel(service, catalogServices)}</span><span className="shrink-0 text-muted">{service.qty_per_cycle}x</span></div>)}
              </div>
            </button>
          )
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border2)] px-5 py-4">
          <div className="flex items-center gap-2"><PawPrint size={16} className="text-emerald-400"/><h2 className="section-title">Assinantes</h2></div>
          <span className="text-xs font-semibold text-muted">{filteredSubscriptions.length} de {subscriptions.length}</span>
        </div>
        <div className="border-b border-[var(--border2)] px-5 py-3">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"/>
            <input className="inp pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por tutor, pet, telefone, pacote ou status..." aria-label="Pesquisar assinantes"/>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[1280px]">
            <thead><tr><th>Pet / Tutor</th><th>Pacote</th><th>Uso no ciclo</th><th>Renovação</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {filteredSubscriptions.map((subscription) => {
                const usage = buildCatalogUsageSummary(subscription, catalogServices)
                const completed = subscriptionIsCompleted(subscription)
                const meta = statusMeta(effectiveSubscriptionStatus(subscription))
                const editable = ['active', 'paused'].includes(subscription.status)
                const cancellable = !completed && subscription.status !== 'cancelled'
                return (
                  <tr key={subscription.id} className={completed ? 'bg-sky-500/5' : subscription.status === 'active' ? 'bg-emerald-500/5' : ''}>
                    <td><p className="font-semibold text-text">{subscription.client?.pet_name || subscription.client?.owner_name}</p><p className="text-xs text-muted">{subscription.client?.owner_name}</p></td>
                    <td><p className="font-semibold text-text">{subscription.subscription_plans?.name || '-'}</p><p className="text-xs text-muted">{fmtCurrency(subscription.subscription_plans?.price || 0)}</p></td>
                    <td><div className="flex max-w-xl flex-wrap gap-2">{usage.map((item) => <span key={`${subscription.id}-${item.service_type}`} className={`badge ${item.remaining > 0 ? 'badge-blue' : 'badge-gray'}`}>{item.label}: {item.used}/{item.total}</span>)}</div></td>
                    <td><div className="flex items-center gap-2"><CalendarClock size={14} className={completed ? 'text-sky-400' : 'text-amber-400'}/><span className="text-sm text-text">{completed ? 'Ciclo concluído' : subscription.next_billing_date || '-'}</span></div></td>
                    <td><span className={`badge ${meta.cls}`}>{meta.label}</span></td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {subscription.status === 'active' && <button type="button" onClick={() => setManagingAppointments(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap"><CalendarClock size={13}/> Agendamentos</button>}
                        <button type="button" disabled={!editable} onClick={() => setEditingUsage(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap" title={editable ? 'Editar consumo do ciclo' : 'Disponível após ativação'}><PencilLine size={13}/> Editar consumo</button>
                        {completed ? (
                          <button type="button" onClick={() => renewSubscription(subscription)} className="btn btn-primary btn-sm whitespace-nowrap"><Repeat2 size={13}/> Renovar pacote</button>
                        ) : (
                          <button type="button" disabled={!cancellable} onClick={() => setCancelling(subscription)} className="btn btn-danger btn-sm whitespace-nowrap"><Ban size={13}/> Cancelar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!filteredSubscriptions.length && !loading && <tr><td colSpan={6} className="py-10 text-center text-muted">Nenhum assinante encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {planModal !== null && <PlanModal plan={planModal.id ? planModal : null} catalogServices={catalogServices} onClose={() => setPlanModal(null)} onSave={handleSavePlan}/>} 
      {subscriptionModal && <SubscriptionModal plans={plans.filter((plan) => plan.active)} clients={clients} catalogServices={catalogServices} context={subscriptionModal} onClose={() => setSubscriptionModal(null)} onSave={handleSaveSubscription} onManagePets={() => { setSubscriptionModal(null); setPage?.('pets') }}/>} 
      {managingAppointments && <PackageAppointmentsModal subscription={managingAppointments} activeTenantId={activeTenantId} moduleId={moduleId} onClose={() => setManagingAppointments(null)} onChanged={reload}/>} 
      {editingUsage && <UsageEditModal subscription={editingUsage} onClose={() => setEditingUsage(null)} onSave={saveUsage}/>} 
      {cancelling && <CancelSubscriptionModal subscription={cancelling} onClose={() => setCancelling(null)} onConfirm={cancelSubscription}/>} 
    </div>
  )
}
