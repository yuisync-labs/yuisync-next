import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bike,
  Cat,
  Clock3,
  Dog,
  Droplets,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Stethoscope,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react'

import { fmtCurrency } from '../../../lib/supabase'
import { usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import {
  defaultServiceCommissionRate,
  serviceSpeciesLabel,
  serviceSpeciesTarget,
  serviceWeightRange,
  serviceWeightRangeLabel,
} from '../lib/appointmentServices'

const SERVICE_GROUPS = [
  { id: 'banho_tosa', label: 'Banho/Tosa', icon: Droplets, defaultIcon: 'droplets' },
  { id: 'veterinaria', label: 'Veterinária', icon: Stethoscope, defaultIcon: 'stethoscope' },
  { id: 'motoboy', label: 'Motoboy', icon: Bike, defaultIcon: 'bike' },
]

const groupMeta = (groupId) => SERVICE_GROUPS.find((group) => group.id === groupId) || SERVICE_GROUPS[0]

const emptyService = (groupId = 'banho_tosa') => ({
  name: '',
  code: '',
  group_type: groupId,
  default_price: '',
  default_duration_min: '60',
  commission_rate: '5',
  min_weight_kg: '',
  max_weight_kg: '',
  species_target: 'all',
  active: true,
  sort_order: '999',
})

const optionalWeightValue = (value) => (
  value === null || value === undefined || value === '' ? '' : String(value)
)

function ServiceModal({ service, initialGroup, onClose, onSave }) {
  const productManaged = service?.service_source === 'product'
  const [form, setForm] = useState(() => service
    ? {
        ...emptyService(service.group_type),
        ...service,
        default_price: String(service.default_price ?? ''),
        default_duration_min: String(service.default_duration_min ?? 60),
        commission_rate: String(service.commission_rate ?? defaultServiceCommissionRate(service)),
        min_weight_kg: optionalWeightValue(service.min_weight_kg),
        max_weight_kg: optionalWeightValue(service.max_weight_kg),
        species_target: serviceSpeciesTarget(service) || 'all',
        sort_order: String(service.sort_order ?? 999),
      }
    : emptyService(initialGroup))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [commissionTouched, setCommissionTouched] = useState(Boolean(service))

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setName = (value) => setForm((current) => ({
    ...current,
    name: value,
    commission_rate: commissionTouched
      ? current.commission_rate
      : String(defaultServiceCommissionRate({ ...current, name: value })),
  }))

  async function submit() {
    const name = String(form.name || '').trim()
    const price = Number(form.default_price)
    const duration = Number(form.default_duration_min)
    const commission = Number(form.commission_rate)
    const minWeight = form.min_weight_kg === '' ? null : Number(form.min_weight_kg)
    const maxWeight = form.max_weight_kg === '' ? null : Number(form.max_weight_kg)
    const speciesTarget = form.group_type === 'banho_tosa' && ['dog', 'cat'].includes(form.species_target)
      ? form.species_target
      : null

    if (!name) return setError('Informe o nome do serviço.')
    if (!Number.isFinite(price) || price < 0) return setError('Informe um valor válido.')
    if (!Number.isFinite(duration) || duration < 15) return setError('A duração mínima é de 15 minutos.')
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) return setError('Informe uma comissão entre 0% e 100%.')
    if (minWeight !== null && (!Number.isFinite(minWeight) || minWeight < 0)) return setError('Informe um peso mínimo válido.')
    if (maxWeight !== null && (!Number.isFinite(maxWeight) || maxWeight < 0)) return setError('Informe um peso máximo válido.')
    if (minWeight !== null && maxWeight !== null && maxWeight < minWeight) return setError('O peso máximo não pode ser menor que o peso mínimo.')

    setSaving(true)
    setError('')
    try {
      const metadata = groupMeta(form.group_type)
      await onSave({
        id: service?.id,
        source_product_id: service?.source_product_id || null,
        service_source: service?.service_source || 'petshop_service',
        name,
        code: String(form.code || '').trim(),
        group_type: form.group_type,
        default_price: price,
        default_duration_min: duration,
        commission_type: 'percentage',
        commission_rate: commission,
        min_weight_kg: form.group_type === 'banho_tosa' ? minWeight : null,
        max_weight_kg: form.group_type === 'banho_tosa' ? maxWeight : null,
        species_target: speciesTarget,
        active: form.active !== false,
        sort_order: Number(form.sort_order || 999),
        icon: metadata.defaultIcon,
      })
      onClose()
    } catch (submitError) {
      setError(submitError?.message || 'Não foi possível salvar o serviço.')
    } finally {
      setSaving(false)
    }
  }

  const inferredRange = form.group_type === 'banho_tosa'
    ? serviceWeightRange({
        ...form,
        min_weight_kg: form.min_weight_kg === '' ? null : form.min_weight_kg,
        max_weight_kg: form.max_weight_kg === '' ? null : form.max_weight_kg,
      })
    : null
  const standardCommission = defaultServiceCommissionRate(form)

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">{service ? 'Editar serviço' : 'Novo serviço'}</h2>
            <p className="mt-1 text-sm text-muted">
              {productManaged
                ? 'Nome, valor e duração continuam controlados pelo Estoque. Espécie, peso e comissão são regras operacionais deste serviço.'
                : 'O item será salvo no catálogo operacional e usado pela Agenda como fonte de verdade.'}
            </p>
          </div>
          <button type="button" aria-label="Fechar serviço" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>

        <div className="modal-body space-y-5">
          <div>
            <label className="inp-label">Área do serviço</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SERVICE_GROUPS.map((group) => {
                const Icon = group.icon
                const selected = form.group_type === group.id
                return (
                  <button
                    key={group.id}
                    type="button"
                    disabled={productManaged}
                    onClick={() => set('group_type', group.id)}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${selected ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border2)] text-muted hover:bg-white/5 hover:text-text'} ${productManaged ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <Icon size={15}/>{group.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="inp-label">Nome</label>
              <input disabled={productManaged} className="inp disabled:cursor-not-allowed disabled:opacity-60" value={form.name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Banho porte pequeno"/>
            </div>
            <div>
              <label className="inp-label">Código interno</label>
              <input disabled={productManaged} className="inp disabled:cursor-not-allowed disabled:opacity-60" value={form.code} onChange={(event) => set('code', event.target.value)} placeholder="Gerado pelo nome"/>
            </div>
            <div>
              <label className="inp-label">Valor</label>
              <input disabled={productManaged} className="inp disabled:cursor-not-allowed disabled:opacity-60" type="number" min="0" step="0.01" value={form.default_price} onChange={(event) => set('default_price', event.target.value)}/>
            </div>
            <div>
              <label className="inp-label">Duração (min)</label>
              <input disabled={productManaged} className="inp disabled:cursor-not-allowed disabled:opacity-60" type="number" min="15" step="5" value={form.default_duration_min} onChange={(event) => set('default_duration_min', event.target.value)}/>
            </div>
            <div>
              <label className="inp-label">Comissão (%)</label>
              <input
                className="inp"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.commission_rate}
                onChange={(event) => {
                  setCommissionTouched(true)
                  set('commission_rate', event.target.value)
                }}
              />
              <p className="mt-1 text-[11px] text-muted">Padrão atual: <strong className="text-text">{standardCommission}%</strong> · qualquer tosa = 10%; demais serviços = 5%. A taxa pode ser personalizada.</p>
            </div>
          </div>

          {form.group_type === 'banho_tosa' && (
            <section className="rounded-xl border border-[var(--border2)] bg-white/[0.03] p-4 space-y-4">
              <div>
                <p className="text-sm font-bold text-text">Compatibilidade do pet</p>
                <p className="mt-1 text-xs text-muted">A Agenda usa estas regras para esconder serviços incompatíveis antes do agendamento.</p>
              </div>

              <div>
                <label className="inp-label">Espécie atendida</label>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => set('species_target', 'all')} className={`rounded-xl border px-3 py-2 text-xs font-bold ${form.species_target === 'all' ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border2)] text-muted'}`}>Cães e gatos</button>
                  <button type="button" onClick={() => set('species_target', 'dog')} className={`flex items-center justify-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold ${form.species_target === 'dog' ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border2)] text-muted'}`}><Dog size={13}/>Cães</button>
                  <button type="button" onClick={() => set('species_target', 'cat')} className={`flex items-center justify-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold ${form.species_target === 'cat' ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border2)] text-muted'}`}><Cat size={13}/>Gatos</button>
                </div>
                <p className="mt-2 text-xs text-muted">Regra atual: <strong className="text-text">{serviceSpeciesLabel(form)}</strong>.</p>
              </div>

              <div>
                <p className="text-sm font-bold text-text">Faixa de peso</p>
                <p className="mt-1 text-xs text-muted">Opcional. Sem faixa explícita, a compatibilidade pode ser inferida do nome legado do serviço.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="inp-label">Peso mínimo (kg)</label>
                  <input className="inp" type="number" min="0" step="0.1" value={form.min_weight_kg} onChange={(event) => set('min_weight_kg', event.target.value)} placeholder="Sem mínimo"/>
                </div>
                <div>
                  <label className="inp-label">Peso máximo (kg)</label>
                  <input className="inp" type="number" min="0" step="0.1" value={form.max_weight_kg} onChange={(event) => set('max_weight_kg', event.target.value)} placeholder="Sem máximo"/>
                </div>
              </div>
              <p className="text-xs text-muted">
                Regra de peso: <strong className="text-text">{serviceWeightRangeLabel({
                  ...form,
                  min_weight_kg: form.min_weight_kg === '' ? null : form.min_weight_kg,
                  max_weight_kg: form.max_weight_kg === '' ? null : form.max_weight_kg,
                })}</strong>{inferredRange?.source === 'name' || inferredRange?.source === 'text' ? ' · inferida pelo nome' : inferredRange?.source === 'configured' ? ' · configurada manualmente' : ''}
              </p>
            </section>
          )}

          <label className={`flex items-center gap-3 rounded-xl border border-[var(--border2)] px-4 py-3 text-sm text-text ${productManaged ? 'opacity-60' : ''}`}>
            <input type="checkbox" disabled={productManaged} checked={form.active !== false} onChange={(event) => set('active', event.target.checked)}/>
            Serviço ativo e disponível para uso
          </label>

          {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="button" onClick={submit} disabled={saving} className="btn btn-primary flex-1 justify-center"><Save size={15}/>{saving ? 'Salvando...' : productManaged ? 'Salvar regras' : 'Salvar serviço'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function ServicosPage() {
  const {
    loadPetshopServices,
    savePetshopService,
    setPetshopServiceActive,
  } = usePetshopAdvanced()
  const [services, setServices] = useState([])
  const [activeGroup, setActiveGroup] = useState('banho_tosa')
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [changingId, setChangingId] = useState('')
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      setServices(await loadPetshopServices())
    } catch (loadError) {
      setError(loadError?.message || 'Não foi possível carregar os serviços.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const counts = useMemo(() => SERVICE_GROUPS.reduce((map, group) => {
    map[group.id] = services.filter((service) => service.group_type === group.id).length
    return map
  }, {}), [services])

  const visibleServices = useMemo(() => services
    .filter((service) => service.group_type === activeGroup)
    .sort((left, right) => Number(left.sort_order || 999) - Number(right.sort_order || 999)
      || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')), [services, activeGroup])

  async function handleSave(payload) {
    await savePetshopService(payload)
    setActiveGroup(payload.group_type)
    await reload()
  }

  async function toggleService(service) {
    setChangingId(service.id)
    setError('')
    try {
      await setPetshopServiceActive(service, service.active === false)
      await reload()
    } catch (toggleError) {
      setError(toggleError?.message || 'Não foi possível alterar o serviço.')
    } finally {
      setChangingId('')
    }
  }

  return (
    <div className="page animate-fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Catálogo de Serviços</h1>
          <p className="page-sub">Preço, duração e regras operacionais ficam centralizados aqui; a Agenda apenas consome o catálogo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reload} className="btn btn-secondary"><RefreshCw size={15}/>Atualizar</button>
          <button type="button" onClick={() => setModal({ mode: 'create' })} className="btn btn-primary"><Plus size={15}/>Novo serviço</button>
        </div>
      </div>

      <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-card p-1" aria-label="Áreas do catálogo de serviços">
        {SERVICE_GROUPS.map((group) => {
          const Icon = group.icon
          const selected = activeGroup === group.id
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroup(group.id)}
              className={`flex min-w-fit items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${selected ? 'bg-emerald-500 text-gray-950' : 'text-muted hover:bg-white/5 hover:text-text'}`}
            >
              <Icon size={15}/>{group.label}<span className={`rounded-full px-2 py-0.5 text-[10px] ${selected ? 'bg-black/15' : 'bg-white/8'}`}>{counts[group.id] || 0}</span>
            </button>
          )
        })}
      </nav>

      {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
        <div className="flex items-center gap-2 border-b border-[var(--border2)] px-5 py-4">
          {(() => { const Icon = groupMeta(activeGroup).icon; return <Icon size={17} className="text-emerald-400"/> })()}
          <h2 className="section-title">Serviços de {groupMeta(activeGroup).label}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl min-w-[980px]">
            <thead><tr><th>Serviço</th><th>Valor</th><th>Duração</th><th>Espécie / peso</th><th>Comissão</th><th>Origem</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {visibleServices.map((service) => {
                const productManaged = service.service_source === 'product'
                const eligibility = service.group_type === 'banho_tosa'
                  ? `${serviceSpeciesLabel(service)} · ${serviceWeightRangeLabel(service)}`
                  : 'Sem restrição da Agenda'
                return (
                  <tr key={`${service.group_type}-${service.id || service.code}`}>
                    <td>
                      <p className="font-semibold text-text">{service.name}</p>
                      <p className="font-mono text-[10px] text-muted">{service.code}</p>
                    </td>
                    <td>{fmtCurrency(service.default_price || 0)}</td>
                    <td><span className="inline-flex items-center gap-1"><Clock3 size={13}/>{service.default_duration_min || 60} min</span></td>
                    <td className="text-xs text-muted">{eligibility}</td>
                    <td>{Number(service.commission_rate ?? defaultServiceCommissionRate(service)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
                    <td><span className={`badge ${productManaged ? 'badge-blue' : 'badge-gray'}`}>{productManaged ? 'Produto / Estoque' : 'Manual'}</span></td>
                    <td><span className={`badge ${service.active !== false ? 'badge-green' : 'badge-gray'}`}>{service.active !== false ? 'Ativo' : 'Inativo'}</span></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button type="button" title={productManaged ? 'Editar regras operacionais' : 'Editar serviço'} onClick={() => setModal({ mode: 'edit', service })} className="btn btn-secondary btn-sm"><Pencil size={13}/>{productManaged ? 'Regras' : 'Editar'}</button>
                        <button type="button" disabled={productManaged || changingId === service.id} onClick={() => toggleService(service)} className="btn btn-ghost btn-sm">
                          {service.active !== false ? <ToggleRight size={17} className="text-emerald-400"/> : <ToggleLeft size={17}/>} {service.active !== false ? 'Desativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!visibleServices.length && !loading && (
                <tr><td colSpan={8} className="py-12 text-center text-muted">Nenhum serviço nesta área. Clique em “Novo serviço” para cadastrar o primeiro.</td></tr>
              )}
              {loading && <tr><td colSpan={8} className="py-12 text-center text-muted">Carregando serviços...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <ServiceModal
          service={modal.mode === 'edit' ? modal.service : null}
          initialGroup={activeGroup}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
