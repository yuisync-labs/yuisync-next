import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Calendar as CalendarIcon, Cat, Dog, Fish, Grid, History, List as ListIcon, PawPrint, Phone, Plus, RefreshCw, Search, Trash2, Upload, Weight, X } from 'lucide-react'
import { Card } from '../../../components/ui'
import { useClients } from '../../../shared/hooks/useClients'
import { useAppointments } from '../../../shared/hooks/useAppointments'
import { usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import { useModuleCtx } from '../../../context/ModuleContext'
import { useAuthCtx } from '../../../context/AuthContext'
import { fmtCurrency, fmtDate } from '../../../lib/supabase'
import { importLegacyRows } from '../../../lib/api'
import { parseLegacyClients } from '../../../shared/lib/legacyImport'
import { matchesSearchTerms } from '../../../shared/lib/searchMatch'

import { createTutorGroupId, groupPetsByTutor } from '../../../shared/lib/petTutorGroups'
const SPECIES = [
  { value: 'dog', label: 'Cao', icon: Dog },
  { value: 'cat', label: 'Gato', icon: Cat },
  { value: 'bird', label: 'Ave', icon: PawPrint },
  { value: 'rabbit', label: 'Coelho', icon: PawPrint },
  { value: 'fish', label: 'Peixe', icon: Fish },
  { value: 'other', label: 'Outro', icon: PawPrint },
]

const EMPTY_FORM = {
  owner_name: '', owner_cpf: '', phone: '', email: '', owner_address: '', owner_neighborhood: '', owner_city: '',
  client_notes: '',
  tutor_birth_date: '', zip_code: '', address_number: '', address_complement: '', address_reference: '',
  pet_name: '', species: 'dog', breed: '', birth_date: '', weight_kg: '', color: '', notes: '',
}

const PLAN_LABELS = { active: 'Ativo', paused: 'Pausado', cancelled: 'Encerrado' }
const CLIENTS_PAGE_SIZE = 60

function digits(value) { return String(value || '').replace(/\D/g, '') }
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() }
function formatPhone(value) { const d = digits(value); if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`; return value || '-' }
function formatCpf(value) { const d = digits(value); if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`; return value || '-' }
function formatPersonName(value) {
  const clean = String(value || '').replace(/^[\s:;,.=_-]+/, '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Tutor sem nome'
  if (clean !== clean.toUpperCase()) return clean
  const lowercaseWords = new Set(['da', 'das', 'de', 'do', 'dos', 'e'])
  return clean.toLocaleLowerCase('pt-BR').split(' ').map((word, index) => (
    index > 0 && lowercaseWords.has(word) ? word : `${word.charAt(0).toLocaleUpperCase('pt-BR')}${word.slice(1)}`
  )).join(' ')
}
function getPlanTone(status) { return status === 'active' ? 'badge-green' : status === 'paused' ? 'badge-amber' : 'badge-gray' }
function getServiceLabel(type) { return ({ banho: 'Banho', tosa: 'Tosa', banho_e_tosa: 'Banho e tosa', consulta: 'Consulta', vacina: 'Vacina', motodog: 'MotoDog' }[type] || type) }
function getRegistrationBadge(pet = {}) {
  if (!pet.owner_cpf || pet.registration_status === 'sem_cpf') return { label: 'Sem CPF', cls: 'badge-red' }
  if (!pet.owner_address || !pet.owner_neighborhood || pet.registration_status === 'sem_endereco') return { label: 'Sem endereco', cls: 'badge-amber' }
  if (pet.registration_status === 'completo') return { label: 'Completo', cls: 'badge-green' }
  return { label: 'Pendente cadastro', cls: 'badge-amber' }
}

function PetModal({ pet, tutorPets = [], plans, subscription, onClose, onSave, onSelectPet, onRemoveClient, confirmingRemoval = false }) {
  const addingPetForTutor = Boolean(pet?.adding_pet_for_tutor)
  const [form, setForm] = useState({
    ...(pet ? { ...EMPTY_FORM, ...pet } : EMPTY_FORM),
    plan_id: subscription?.status === 'cancelled' ? '' : (subscription?.plan_id || ''),
    subscription_status: subscription?.status === 'paused' ? 'paused' : 'active',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!form.owner_name.trim()) return setError('Informe o nome do tutor.')
    if (!form.phone.trim()) return setError('Informe o telefone.')
    if (!form.pet_name.trim()) return setError('Informe o nome do pet.')
    setSaving(true)
    setError('')
    try {
      await onSave({
        petPayload: {
          tutor_group_id: form.tutor_group_id || null,
          owner_name: form.owner_name.trim(), owner_cpf: formatCpf(form.owner_cpf), phone: formatPhone(form.phone), email: form.email.trim(),
          client_notes: form.client_notes || '',
          owner_address: form.owner_address.trim(), owner_neighborhood: form.owner_neighborhood.trim(), owner_city: form.owner_city.trim(),
          tutor_birth_date: form.tutor_birth_date || null, zip_code: form.zip_code.trim(), address_number: form.address_number.trim(), address_reference: form.address_reference.trim(),
          pet_name: form.pet_name.trim(), species: form.species, breed: form.breed.trim(), birth_date: form.birth_date || null,
          weight_kg: form.weight_kg ? Number(form.weight_kg) : null, color: form.color.trim(), notes: form.notes.trim(),
        },
        planId: form.plan_id || null,
        subscriptionStatus: form.subscription_status,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Nao foi possivel salvar.')
    } finally {
      setSaving(false)
    }
  }

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" style={confirmingRemoval ? { display: 'none' } : undefined} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-3xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display font-bold text-xl text-text">{addingPetForTutor ? 'Adicionar pet ao cliente' : pet?.id ? 'Editar cliente e pet' : 'Novo cliente e pet'}</h2>
            <p className="text-sm text-muted mt-1">{addingPetForTutor ? 'Os dados do tutor foram mantidos; complete apenas o novo pet.' : 'Essa tela conversa direto com a aba de planos.'}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text"><X size={18} /></button>
        </div>
        <div className="modal-body space-y-5">
          {addingPetForTutor && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Novo pet para <strong>{form.owner_name}</strong>. Os dados do tutor ficam bloqueados para evitar cadastros divergentes.
            </div>
          )}
          {!addingPetForTutor && pet?.id && tutorPets.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-card p-4"><p className="text-xs font-bold uppercase tracking-widest text-muted">Pets deste cliente</p><div className="mt-3 flex flex-wrap gap-2">{tutorPets.map((item) => (<button key={item.id} type="button" onClick={() => item.id !== pet.id && onSelectPet?.(item)} className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${item.id === pet.id ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border)] text-text hover:border-emerald-500/30'}`}><strong>{item.pet_name || 'Pet sem nome'}</strong><span className="ml-2 text-xs text-muted">{item.breed || item.species || ''}</span></button>))}</div></div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <fieldset disabled={addingPetForTutor} className="rounded-2xl border border-[var(--border)] bg-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3 disabled:opacity-70">
              <div className="md:col-span-2"><label className="inp-label">Tutor</label><input className="inp" value={form.owner_name} onChange={(e) => setField('owner_name', e.target.value)} /></div>
              <div><label className="inp-label">Telefone</label><input className="inp" value={form.phone} onChange={(e) => setField('phone', e.target.value)} /></div>
              <div><label className="inp-label">CPF</label><input className="inp" value={form.owner_cpf} onChange={(e) => setField('owner_cpf', e.target.value)} /></div>
              <div><label className="inp-label">Nascimento do tutor</label><input className="inp" type="date" value={form.tutor_birth_date || ''} onChange={(e) => setField('tutor_birth_date', e.target.value)} /></div>
              <div><label className="inp-label">CEP</label><input className="inp" value={form.zip_code || ''} onChange={(e) => setField('zip_code', e.target.value)} /></div>
              <div className="md:col-span-2"><label className="inp-label">Email</label><input className="inp" value={form.email} onChange={(e) => setField('email', e.target.value)} /></div>
              <div className="md:col-span-2"><label className="inp-label">Endereco</label><input className="inp" value={form.owner_address} onChange={(e) => setField('owner_address', e.target.value)} /></div>
              <div><label className="inp-label">Numero</label><input className="inp" value={form.address_number || ''} onChange={(e) => setField('address_number', e.target.value)} /></div>
              <div><label className="inp-label">Complemento</label><input className="inp" value={form.address_complement || ''} onChange={(e) => setField('address_complement', e.target.value)} /></div>
              <div><label className="inp-label">Bairro</label><input className="inp" value={form.owner_neighborhood} onChange={(e) => setField('owner_neighborhood', e.target.value)} /></div>
              <div><label className="inp-label">Cidade</label><input className="inp" value={form.owner_city} onChange={(e) => setField('owner_city', e.target.value)} /></div>
              <div><label className="inp-label">Referencia</label><input className="inp" value={form.address_reference || ''} onChange={(e) => setField('address_reference', e.target.value)} /></div>
            </fieldset>
            <div className="rounded-2xl border border-[var(--border)] bg-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><label className="inp-label">Pet</label><input className="inp" value={form.pet_name} onChange={(e) => setField('pet_name', e.target.value)} /></div>
              <div><label className="inp-label">Especie</label><select className="inp" value={form.species} onChange={(e) => setField('species', e.target.value)}>{SPECIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div><label className="inp-label">Raca</label><input className="inp" value={form.breed} onChange={(e) => setField('breed', e.target.value)} /></div>
              <div><label className="inp-label">Nascimento</label><input className="inp" type="date" value={form.birth_date || ''} onChange={(e) => setField('birth_date', e.target.value)} /></div>
              <div><label className="inp-label">Peso</label><input className="inp" type="number" min="0" step="0.1" value={form.weight_kg || ''} onChange={(e) => setField('weight_kg', e.target.value)} /></div>
              <div><label className="inp-label">Cor</label><input className="inp" value={form.color} onChange={(e) => setField('color', e.target.value)} /></div>
              <div className="md:col-span-2"><label className="inp-label">Plano atual</label><select className="inp" value={form.plan_id} onChange={(e) => setField('plan_id', e.target.value)}><option value="">Sem plano ativo</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} - {fmtCurrency(plan.price)}</option>)}</select></div>
              {form.plan_id && <div className="md:col-span-2"><label className="inp-label">Status do plano</label><select className="inp" value={form.subscription_status} onChange={(e) => setField('subscription_status', e.target.value)}><option value="active">Ativo</option><option value="paused">Pausado</option></select></div>}
              <div className="md:col-span-2"><label className="inp-label">Observacoes do pet</label><textarea className="inp h-24 resize-none p-4" value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></div>
            </div>
          </div>
          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
          <div className="flex flex-wrap gap-3">
            {pet?.id && !addingPetForTutor && <button type="button" disabled={saving} onClick={() => onRemoveClient(pet)} className="btn btn-secondary text-red-400"><Trash2 size={14} />Excluir cliente</button>}
            <button onClick={onClose} disabled={saving} className="btn btn-secondary flex-1 justify-center">Cancelar</button><button onClick={submit} disabled={saving} className="btn btn-primary flex-1 justify-center">{saving ? 'Salvando...' : addingPetForTutor ? 'Salvar novo pet' : 'Salvar cadastro'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PetDrawer({ pet, tutorPets = [], subscriptions = [], historyGroupKey, onClose, onEdit, onRemove, onAddPet, onSelectPet, speciesIcon, serviceLabel, statusBadge }) {
  const { appointments, load } = useAppointments()
  useEffect(() => { if (pet?.id) load({ date: '' }) }, [pet?.id])
  if (!pet) return null
  const Icon = speciesIcon(pet.species)
  const recentAppointments = appointments.filter((item) => item.pets?.id === pet.id).slice(0, 8)
  const registrationBadge = getRegistrationBadge(pet)
  const packageSubscriptions = (subscriptions || []).filter((item) => ['active', 'paused'].includes(item.status))
  const activePackageSubscriptions = packageSubscriptions.filter((item) => item.status === 'active')
  const combinedUsageMap = new Map()
  packageSubscriptions.forEach((item) => {
    ;(item.usage_summary || []).forEach((usage) => {
      const key = usage.service_type || usage.service_code || usage.label
      if (!key) return
      const current = combinedUsageMap.get(key) || { ...usage, used: 0, total: 0, remaining: 0 }
      combinedUsageMap.set(key, {
        ...current,
        used: Number(current.used || 0) + Number(usage.used || 0),
        total: Number(current.total || 0) + Number(usage.total || 0),
        remaining: Number(current.remaining || 0) + Number(usage.remaining || 0),
      })
    })
  })
  const combinedUsage = [...combinedUsageMap.values()]
  const nextBilling = activePackageSubscriptions.map((item) => item.next_billing_date).filter(Boolean).sort()[0] || '-'

  return createPortal(
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/50 p-3 backdrop-blur-[8px] sm:p-6 theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <Card role="dialog" aria-modal="true" aria-label={`Detalhes de ${pet.pet_name || 'pet'}`} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
          const edge = event.shiftKey ? buttons[0] : buttons.at(-1)
          if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus() }
        }
      }} className="modal-box relative w-full max-w-4xl max-h-[90dvh] shadow-card">
        <div className="shrink-0 border-b border-[var(--border2)] p-4 sm:p-6">
          <button type="button" autoFocus aria-label="Fechar detalhes" title="Fechar" onClick={onClose} className="absolute right-4 top-4 rounded-lg p-2 text-muted hover:text-text"><X size={18} /></button>
          <div className="flex min-w-0 items-start gap-3 pr-12"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500"><Icon size={22} /></div><div className="min-w-0"><h2 className="break-words font-display text-lg font-bold leading-snug text-text sm:text-xl">{pet.owner_name}</h2><p className="mt-1 break-words text-sm text-muted">{pet.pet_name || 'Pet sem nome'}{pet.breed ? ` - ${pet.breed}` : ''}</p><span className={`badge ${registrationBadge.cls} mt-2`}>{registrationBadge.label}</span></div></div>
          <div className="mt-4 flex flex-wrap items-center gap-2">{historyGroupKey && <button type="button" data-yuisync-client-history={historyGroupKey} className="btn btn-secondary btn-sm"><History size={13}/> Histórico</button>}<button type="button" data-yuisync-add-pet-action aria-label={`Adicionar outro pet para ${pet.owner_name || 'este tutor'}`} onClick={() => onAddPet(pet)} className="btn btn-primary btn-sm"><Plus size={13}/> Adicionar pet</button><button onClick={() => onEdit(pet)} className="btn btn-secondary btn-sm">Editar</button><button type="button" onClick={() => onRemove(pet)} className="btn btn-secondary btn-sm text-red-400"><Trash2 size={13}/> Remover pet</button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold">Pets deste cliente</p><div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">{tutorPets.map((item) => (<button key={item.id} type="button" onClick={() => item.id !== pet.id && onSelectPet?.(item)} className={`rounded-xl border p-3 text-left ${item.id === pet.id ? 'border-emerald-500/45 bg-emerald-500/12' : 'border-[var(--border)] hover:border-emerald-500/30'}`}><p className="font-semibold text-text">{item.pet_name || 'Pet sem nome'}</p><p className="mt-1 text-xs text-muted">{item.breed || item.species || 'Sem raca informada'}</p></button>))}</div></div>
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Tutor</p><p className="text-text font-semibold mt-1">{pet.owner_name || '-'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Pet</p><p className="text-text font-semibold mt-1">{pet.pet_name || '-'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Telefone</p><p className="text-text font-semibold mt-1">{formatPhone(pet.phone)}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">CPF</p><p className="text-text font-semibold mt-1">{formatCpf(pet.owner_cpf)}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Nascimento tutor</p><p className="text-text font-semibold mt-1">{fmtDate(pet.tutor_birth_date) || '-'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">CEP</p><p className="text-text font-semibold mt-1">{pet.zip_code || '-'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Nascimento</p><p className="text-text font-semibold mt-1">{fmtDate(pet.birth_date) || '-'}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Peso</p><p className="text-text font-semibold mt-1">{pet.weight_kg ? `${pet.weight_kg} kg` : '-'}</p></div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-3">
            <p className="text-xs uppercase tracking-widest text-muted font-bold">Endereco</p>
            <div className="text-sm text-text font-semibold leading-relaxed">
              {pet.owner_address || 'Endereco nao informado'}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Numero</p><p className="text-text font-semibold mt-1">{pet.address_number || '-'}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Complemento</p><p className="text-text font-semibold mt-1">{pet.address_complement || '-'}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Bairro</p><p className="text-text font-semibold mt-1">{pet.owner_neighborhood || '-'}</p></div>
              <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Cidade</p><p className="text-text font-semibold mt-1">{pet.owner_city || '-'}</p></div>
            </div>
            <div><p className="text-[10px] uppercase tracking-widest text-muted font-bold">Referencia</p><p className="text-text font-semibold mt-1 leading-relaxed">{pet.address_reference || '-'}</p></div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-3"><p className="text-xs uppercase tracking-widest text-muted font-bold">Pacotes vinculados</p>{packageSubscriptions.length > 0 && <span className={`badge ${activePackageSubscriptions.length ? 'badge-green' : 'badge-amber'}`}>{activePackageSubscriptions.length ? `${activePackageSubscriptions.length} ativo(s)` : 'Pausado'}</span>}</div>
            {packageSubscriptions.length > 0 ? (
              <>
                <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted">Compras</span><span className="text-right font-semibold text-text">{packageSubscriptions.map((item) => item.subscription_plans?.name || 'Pacote').join(' + ')}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted">Proxima cobranca</span><span className="font-semibold text-text">{nextBilling}</span></div>
                <div className="space-y-2 pt-2">{combinedUsage.map((usage) => <div key={usage.service_type || usage.service_code || usage.label} className="rounded-xl border border-[var(--border)] bg-surface/70 px-4 py-3"><div className="flex items-center justify-between gap-3 text-sm"><span className="text-text">{usage.label || getServiceLabel(usage.service_type)}</span><span className="text-emerald-500 font-semibold">{usage.remaining} restantes</span></div><p className="text-xs text-muted mt-1">{usage.used}/{usage.total} usados somando os pacotes</p></div>)}</div>
              </>
            ) : <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-muted">Este pet ainda nao tem pacote ativo ou pausado.</div>}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-3">
            <p className="text-xs uppercase tracking-widest text-muted font-bold">Ultimos atendimentos</p>
            {recentAppointments.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-muted">Nenhum atendimento encontrado para este pet.</div> : <div className="space-y-2">{recentAppointments.map((item) => { const badge = statusBadge(item.status); return <div key={item.id} className="rounded-xl border border-[var(--border)] bg-surface/70 px-4 py-3 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-text">{serviceLabel(item.service_type)}</p><p className="text-xs text-muted mt-1">{fmtDate(item.scheduled_at) || '-'}</p></div><div className="text-right"><span className={`badge ${badge.cls}`}>{badge.label}</span><p className="text-xs text-emerald-500 font-semibold mt-1">{fmtCurrency(item.price || 0)}</p></div></div> })}</div>}
          </div>
        </div>
      </Card>
    </div>,
    document.body,
  )
}

function chunkRows(rows, size = 250) {
  const chunks = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  return chunks
}

function LegacyClientsImportModal({ onClose, moduleId, tenantId, onDone }) {
  const [file, setFile] = useState(null)
  const [summary, setSummary] = useState(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  async function executeImport() {
    if (!file) return
    setImporting(true)
    setError('')
    setProgress(0)
    try {
      const parsed = await parseLegacyClients(file)
      const totals = { created: 0, updated: 0, skipped: parsed.skipped }
      const chunks = chunkRows(parsed.rows)
      for (const [index, rows] of chunks.entries()) {
        const result = await importLegacyRows({ kind: 'clients', rows, moduleId, tenantId })
        totals.created += Number(result.created || 0)
        totals.updated += Number(result.updated || 0)
        totals.skipped += Number(result.skipped || 0)
        setProgress(Math.round(((index + 1) / chunks.length) * 100))
      }
      setSummary(totals)
      await onDone?.()
    } catch (err) {
      setError(err?.message || 'Erro ao importar clientes legados.')
    } finally {
      setImporting(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(e) => !importing && e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-lg">
        <div className="modal-header">
          <h2 className="font-display font-bold text-xl text-text">Import Legado de Clientes</h2>
          {!importing && <button type="button" aria-label="Fechar importacao" title="Fechar" onClick={onClose} className="text-muted hover:text-text"><X size={18} /></button>}
        </div>
        <div className="modal-body space-y-4">
          <p className="text-sm text-muted">Importacao isolada para admin global. Aceita o XLS de clientes do sistema antigo.</p>
          <label className="flex items-center justify-between gap-3 border border-[var(--border)] rounded-xl p-4 cursor-pointer hover:bg-white/5 transition-colors">
            <div><p className="text-sm font-semibold text-text">Importar clientes</p><p className="text-xs text-muted">{file ? file.name : 'Clientes (.xlsx/.csv)'}</p></div>
            <Upload size={18} className="text-emerald-500" />
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          {importing && <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden"><div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} /></div>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {summary && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-text">Clientes: {summary.created} criados, {summary.updated} atualizados, {summary.skipped} ignorados.</div>}
          <div className="flex gap-3"><button disabled={importing} onClick={onClose} className="btn btn-secondary flex-1 justify-center">Fechar</button><button disabled={importing || !file} onClick={executeImport} className="btn btn-primary flex-1 justify-center"><Upload size={14} /> {importing ? `${progress}%` : 'Importar Clientes'}</button></div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function PetsPage() {
  const { clients: pets, loading, error: clientsError, load, create, update, remove, removeTutor, speciesIcon, age } = useClients()
  const { serviceLabel, statusBadge } = useAppointments()
  const { loadPlans, loadClientSubscriptions, saveClientSubscription } = usePetshopAdvanced()
  const { activeModuleId } = useModuleCtx()
  const auth = useAuthCtx()
  const isGlobalAdmin = auth?.profile?.role === 'admin'
  const [search, setSearch] = useState('')
  const [speciesFilter, setSpeciesFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [view, setView] = useState('grid')
  const [page, setPage] = useState(1)
  const [modalPet, setModalPet] = useState(null)
  const [drawerPet, setDrawerPet] = useState(null)
  const [removingPet, setRemovingPet] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [removingClient, setRemovingClient] = useState(false)
  const [legacyImportModal, setLegacyImportModal] = useState(false)
  const [plans, setPlans] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [pageError, setPageError] = useState('')

  const isPetModule = activeModuleId === 'petshop'

  async function reloadAll() {
    try {
      setPageError('')
      await Promise.all([load(), loadPlans().then(setPlans), loadClientSubscriptions().then(setSubscriptions)])
    } catch (error) {
      setPageError(error.message || 'Nao foi possivel carregar os clientes.')
    }
  }

  useEffect(() => { reloadAll() }, [])

  const subscriptionsByClient = useMemo(() => {
    const map = new Map()
    ;[...(subscriptions || [])].sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0)).forEach((item) => {
      const rows = map.get(item.client_id) || []
      rows.push(item)
      map.set(item.client_id, rows)
    })
    return map
  }, [subscriptions])

  const latestSubscriptionByClient = useMemo(() => {
    const map = new Map()
    ;[...(subscriptions || [])].sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0)).forEach((item) => { if (!map.has(item.client_id)) map.set(item.client_id, item) })
    return map
  }, [subscriptions])

  const activePlanCount = useMemo(() => [...subscriptionsByClient.values()].filter((items) => items.some((item) => item.status === 'active')).length, [subscriptionsByClient])

  const filteredPets = useMemo(() => {
    const query = normalize(search)
    const queryDigits = digits(search)
    return (pets || []).filter((pet) => {
      const clientSubscriptions = subscriptionsByClient.get(pet.id) || []
      const subscription = latestSubscriptionByClient.get(pet.id)
      const matchesText = Boolean(query) && matchesSearchTerms(search, [
        pet.owner_name,
        pet.pet_name,
        pet.breed,
        pet.owner_address,
        pet.owner_neighborhood,
        pet.owner_city,
        ...clientSubscriptions.map((item) => item.subscription_plans?.name),
      ])
      const matchesDigits = Boolean(queryDigits) && [pet.phone, pet.owner_cpf].some((field) => digits(field).includes(queryDigits))
      const matchesSearch = (!query && !queryDigits) || matchesText || matchesDigits
      const matchesSpecies = !speciesFilter || pet.species === speciesFilter
      const matchesPlan = !planFilter || clientSubscriptions.some((item) => item.status === planFilter)
      return matchesSearch && matchesSpecies && matchesPlan
    })
  }, [latestSubscriptionByClient, pets, planFilter, search, speciesFilter, subscriptionsByClient])

  useEffect(() => {
    setPage(1)
  }, [search, speciesFilter, planFilter, view])

  const filteredTutorGroups = useMemo(() => groupPetsByTutor(filteredPets), [filteredPets])
  const tutorPetsByPetId = useMemo(() => {
    const map = new Map()
    groupPetsByTutor(pets || []).forEach((group) => group.pets.forEach((pet) => map.set(pet.id, group.pets)))
    return map
  }, [pets])
  const tutorGroupKeyByPetId = useMemo(() => {
    const map = new Map()
    groupPetsByTutor(pets || []).forEach((group) => group.pets.forEach((item) => map.set(item.id, group.key)))
    return map
  }, [pets])
  const totalPages = Math.max(1, Math.ceil(filteredTutorGroups.length / CLIENTS_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * CLIENTS_PAGE_SIZE
  const visibleTutorGroups = filteredTutorGroups.slice(pageStart, pageStart + CLIENTS_PAGE_SIZE)

  function openAddPetForTutor(pet) {
    const tutorGroupId = pet.tutor_group_id || createTutorGroupId()
    setDrawerPet(null)
    setModalPet({
      adding_pet_for_tutor: true,
      source_tutor: pet,
      tutor_group_id: tutorGroupId,
      owner_name: pet.owner_name || '',
      owner_cpf: pet.owner_cpf || '',
      phone: pet.phone || '',
      email: pet.email || '',
      client_notes: pet.client_notes || '',
      owner_address: pet.owner_address || '',
      owner_neighborhood: pet.owner_neighborhood || '',
      owner_city: pet.owner_city || '',
      tutor_birth_date: pet.tutor_birth_date || '',
      zip_code: pet.zip_code || '',
      address_number: pet.address_number || '',
      address_complement: pet.address_complement || '',
      address_reference: pet.address_reference || '',
      pet_name: '',
      species: 'dog',
      breed: '',
      birth_date: '',
      weight_kg: '',
      color: '',
      notes: '',
    })
  }

  async function handleSave({ petPayload, planId, subscriptionStatus }) {
    const addingPetForTutor = Boolean(modalPet?.adding_pet_for_tutor && modalPet?.source_tutor?.id)
    const currentSubscription = !addingPetForTutor && modalPet?.id ? latestSubscriptionByClient.get(modalPet.id) : null
    let savedPet

    if (addingPetForTutor) {
      const tutorGroupId = modalPet.tutor_group_id || createTutorGroupId()
      if (!modalPet.source_tutor.tutor_group_id) {
        await update(modalPet.source_tutor.id, {
          ...modalPet.source_tutor,
          tutor_group_id: tutorGroupId,
        })
      }
      savedPet = await create({ ...petPayload, tutor_group_id: tutorGroupId })
    } else {
      savedPet = modalPet?.id ? await update(modalPet.id, petPayload) : await create(petPayload)
    }

    if (planId) {
      const selectedPlan = plans.find((plan) => plan.id === planId)
      await saveClientSubscription({ id: currentSubscription?.id, client_id: savedPet.id, plan_id: planId, plan: selectedPlan, status: subscriptionStatus || 'active', started_at: currentSubscription?.started_at || new Date().toISOString().slice(0, 10), next_billing_date: currentSubscription?.next_billing_date, services_used: currentSubscription?.services_used || {} })
    } else if (currentSubscription && currentSubscription.status !== 'cancelled') {
      await saveClientSubscription({ id: currentSubscription.id, client_id: savedPet.id, plan_id: currentSubscription.plan_id, plan: currentSubscription.subscription_plans, status: 'cancelled', started_at: currentSubscription.started_at, next_billing_date: currentSubscription.next_billing_date, services_used: currentSubscription.services_used || {} })
    }
    await reloadAll()
  }

  async function handleDelete() {
    if (!removingPet || removing) return
    setRemoving(true)
    setRemoveError('')
    try {
      await (removingClient ? removeTutor(removingPet.id) : remove(removingPet.id))
      if (removingClient || drawerPet?.id === removingPet.id) setDrawerPet(null)
      if (removingClient || modalPet?.id === removingPet.id) setModalPet(null)
      setRemovingPet(null)
    } catch (error) {
      setRemoveError(error.message || 'Não foi possível excluir o cadastro. Tente novamente.')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="page animate-fade-up space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><PawPrint size={22} className="text-emerald-500" />{isPetModule ? 'Clientes & Pets' : 'Clientes'}</h1>
          <p className="page-sub">{pets.length} cadastros, {activePlanCount} com plano ativo visivel nesta aba.</p>
        </div>
        <div className="flex gap-2">
          {isGlobalAdmin && <button onClick={() => setLegacyImportModal(true)} className="btn btn-secondary border-emerald-500/20 text-emerald-500"><Upload size={15} /> Import Legado</button>}
          <button onClick={() => setModalPet({})} className="btn btn-primary"><Plus size={15} /> Novo cadastro</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold">Cadastros ativos</p><p className="font-display font-bold text-3xl text-text mt-2">{pets.length}</p></div>
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold">Planos ativos</p><p className="font-display font-bold text-3xl text-emerald-500 mt-2">{activePlanCount}</p></div>
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold">Conexao com a aba de planos</p><p className="text-sm text-muted mt-2">Voce consegue cadastrar, pausar ou trocar plano direto daqui.</p></div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="inp pl-9" placeholder="Buscar tutor, pet, raca, cidade ou plano..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="inp w-auto" value={speciesFilter} onChange={(e) => setSpeciesFilter(e.target.value)}><option value="">Especies</option>{SPECIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select className="inp w-auto" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}><option value="">Todos os planos</option><option value="active">Plano ativo</option><option value="paused">Plano pausado</option></select>
        <div className="flex bg-surface border border-[var(--border)] rounded-xl p-1"><button type="button" aria-label="Visualizacao em grade" onClick={() => setView('grid')} className={`px-3 py-2 rounded-lg ${view === 'grid' ? 'bg-emerald-500 text-white' : 'text-muted'}`}><Grid size={16} /></button><button type="button" aria-label="Visualizacao em lista" onClick={() => setView('list')} className={`px-3 py-2 rounded-lg ${view === 'list' ? 'bg-emerald-500 text-white' : 'text-muted'}`}><ListIcon size={16} /></button></div>
        <button onClick={reloadAll} className="btn btn-secondary"><RefreshCw size={14} /> Atualizar</button>
      </div>

      {(pageError || clientsError) && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{pageError || clientsError}</div>}

      {!loading && filteredPets.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span>Exibindo {pageStart + 1}-{Math.min(pageStart + CLIENTS_PAGE_SIZE, filteredTutorGroups.length)} de {filteredTutorGroups.length} clientes</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-secondary btn-sm" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
              <span>Pagina {currentPage} de {totalPages}</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Proxima</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[var(--border)] bg-card px-6 py-12 text-center text-muted"><RefreshCw size={18} className="animate-spin mx-auto mb-3" />Carregando clientes...</div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleTutorGroups.map((group) => { const pet = group.pets[0]; const Icon = speciesIcon(pet.species); const registrationBadge = getRegistrationBadge(pet); const activePackages = group.pets.flatMap((item) => subscriptionsByClient.get(item.id) || []).filter((item) => item.status === 'active'); return (
            <div key={group.key} className="flex min-h-[270px] flex-col rounded-2xl border border-[var(--border)] bg-card p-5 shadow-card transition-all hover:-translate-y-1 hover:border-emerald-500/30"><div className="flex items-start gap-4"><div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center flex-shrink-0"><Icon size={24}/></div><div className="min-w-0 flex-1"><h3 className="line-clamp-2 text-base font-bold leading-snug text-text">{formatPersonName(group.owner_name || pet.owner_name)}</h3><p className="mt-1 text-xs font-semibold text-emerald-500">{group.pets.length} {group.pets.length === 1 ? 'pet cadastrado' : 'pets cadastrados'}</p></div><span className={`badge flex-shrink-0 ${registrationBadge.cls}`}>{registrationBadge.label}</span></div>
              <div className="mt-4 space-y-2">{group.pets.map((item) => (<button key={item.id} type="button" onClick={() => setDrawerPet(item)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border2)] bg-surface/60 px-3 py-2 text-left hover:border-emerald-500/30"><span className="min-w-0"><strong className="block truncate text-sm text-text">{item.pet_name || 'Pet sem nome'}</strong><span className="block truncate text-xs text-muted">{item.breed || item.species || 'Sem raca informada'}</span></span><span className="text-xs font-semibold text-emerald-500">Abrir</span></button>))}</div>
              <div className="mt-auto border-t border-[var(--border2)] pt-4"><div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div className="flex min-w-0 items-center gap-2 text-muted"><Phone size={13} className="flex-shrink-0 text-emerald-500"/><span className="truncate">{formatPhone(pet.phone)}</span></div><div className="flex min-w-0 items-center gap-2 text-muted"><PawPrint size={13} className="flex-shrink-0 text-emerald-500"/><span className="truncate">{activePackages.length} pacote(s) ativo(s)</span></div></div><div className="mt-4 flex flex-wrap items-center justify-end gap-2"><button type="button" data-yuisync-client-history={group.key} className="btn btn-secondary btn-sm"><History size={13}/> Histórico</button><button type="button" data-yuisync-add-pet-action onClick={() => openAddPetForTutor(pet)} className="btn btn-primary btn-sm"><Plus size={13}/> Adicionar pet</button><button onClick={() => setModalPet(pet)} className="btn btn-secondary btn-sm">Editar cliente</button></div></div></div>
          )})}
          {filteredTutorGroups.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-[var(--border)] px-6 py-12 text-center"><p className="text-text font-semibold">Nenhum cadastro encontrado</p></div>}
        </div>
      ) : (
        <div className="bg-card border border-[var(--border)] rounded-2xl overflow-hidden"><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Tutor</th><th>Pets</th><th>Telefone</th><th>Pacotes ativos</th><th className="text-right">Acoes</th></tr></thead><tbody>{visibleTutorGroups.map((group) => { const pet = group.pets[0]; const activePackages = group.pets.flatMap((item) => subscriptionsByClient.get(item.id) || []).filter((item) => item.status === 'active'); return <tr key={group.key}><td className="font-semibold text-text">{formatPersonName(group.owner_name || pet.owner_name)}</td><td><div className="flex flex-wrap gap-1">{group.pets.map((item) => <button key={item.id} type="button" onClick={() => setDrawerPet(item)} className="badge badge-green">{item.pet_name || 'Pet'}</button>)}</div></td><td>{formatPhone(pet.phone)}</td><td>{activePackages.length}</td><td className="text-right"><div className="flex justify-end gap-2"><button type="button" data-yuisync-client-history={group.key} className="btn btn-secondary btn-sm"><History size={13}/> Histórico</button><button type="button" data-yuisync-add-pet-action onClick={() => openAddPetForTutor(pet)} className="btn btn-primary btn-sm"><Plus size={13}/> Adicionar pet</button><button onClick={() => setModalPet(pet)} className="btn btn-secondary btn-sm">Editar</button></div></td></tr>})}{filteredTutorGroups.length === 0 && <tr><td colSpan={5} className="text-center text-muted py-10">Nenhum cadastro encontrado.</td></tr>}</tbody></table></div></div>
      )}

      {modalPet !== null && <PetModal confirmingRemoval={Boolean(removingPet)} key={modalPet?.id || (modalPet?.adding_pet_for_tutor ? 'new-pet' : 'new-client')} pet={modalPet} tutorPets={modalPet?.id ? (tutorPetsByPetId.get(modalPet.id) || [modalPet]) : []} plans={plans.filter((plan) => plan.active)} subscription={modalPet?.id ? latestSubscriptionByClient.get(modalPet.id) : null} onSelectPet={setModalPet} onClose={() => setModalPet(null)} onSave={handleSave} onRemoveClient={(pet) => { setRemoveError(''); setRemovingClient(true); setRemovingPet(pet) }} />}
      {drawerPet && <PetDrawer pet={drawerPet} historyGroupKey={tutorGroupKeyByPetId.get(drawerPet.id) || ''} tutorPets={tutorPetsByPetId.get(drawerPet.id) || [drawerPet]} subscriptions={subscriptionsByClient.get(drawerPet.id) || []} onSelectPet={setDrawerPet} onClose={() => setDrawerPet(null)} onAddPet={openAddPetForTutor} onRemove={(pet) => { setRemoveError(''); setRemovingClient(false); setRemovingPet(pet) }} onEdit={(pet) => { setDrawerPet(null); setModalPet(pet) }} speciesIcon={speciesIcon} serviceLabel={serviceLabel} statusBadge={statusBadge} />}
      {removingPet && createPortal(
        <div className="modal-overlay theme-petshop-modal" onClick={(event) => !removing && event.target === event.currentTarget && setRemovingPet(null)}>
          <Card role="dialog" aria-modal="true" aria-labelledby="remove-pet-title" onKeyDown={(event) => {
            if (event.key === 'Escape' && !removing) { event.stopPropagation(); setRemovingPet(null) }
            if (event.key === 'Tab') {
              const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
              const target = event.shiftKey ? buttons.at(-1) : buttons[0]
              const edge = event.shiftKey ? buttons[0] : buttons.at(-1)
              if (document.activeElement === edge) { event.preventDefault(); target?.focus() }
            }
          }} className="w-full max-w-md p-6 shadow-2xl">
            <h2 id="remove-pet-title" className="text-lg font-bold text-text">{removingClient ? `Excluir cliente ${removingPet.owner_name || 'sem nome'}?` : `Remover ${removingPet.pet_name || 'pet'}?`}</h2>
            <p className="mt-3 text-sm text-muted">{removingClient ? 'Confirma a exclusão deste cliente e de todos os seus pets dos cadastros ativos? O histórico de atendimentos será preservado.' : 'Este pet sairá dos cadastros ativos. O histórico de atendimentos será preservado. Os outros pets deste tutor continuarão cadastrados.'}</p>
            {(removingClient ? (tutorPetsByPetId.get(removingPet.id) || [removingPet]).flatMap(pet => subscriptionsByClient.get(pet.id) || []) : (subscriptionsByClient.get(removingPet.id) || [])).some((item) => ['active', 'paused'].includes(item.status)) && <p className="mt-3 text-sm text-amber-400">{removingClient ? 'Há pacote ativo ou pausado vinculado ao cadastro. A exclusão não cancela pacotes; gerencie-os na aba Planos.' : 'Este pet tem um pacote ativo ou pausado. A remoção do cadastro não cancela o pacote; gerencie-o na aba Planos.'}</p>}
            {removeError && <p role="alert" className="mt-3 text-sm text-red-400">{removeError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" autoFocus disabled={removing} onClick={() => setRemovingPet(null)} className="btn btn-secondary">Cancelar</button>
              <button type="button" disabled={removing} onClick={handleDelete} className="btn btn-secondary text-red-400"><Trash2 size={14}/>{removing ? 'Excluindo...' : removingClient ? 'Confirmar exclusão' : 'Remover pet'}</button>
            </div>
          </Card>
        </div>,
        document.body,
      )}
      {legacyImportModal && <LegacyClientsImportModal moduleId={activeModuleId} tenantId={auth?.activeTenantId} onClose={() => setLegacyImportModal(false)} onDone={reloadAll} />}
    </div>
  )
}
