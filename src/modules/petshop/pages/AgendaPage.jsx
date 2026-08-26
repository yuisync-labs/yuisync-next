import { useDeferredValue, useMemo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Calendar, Plus, Search, ChevronLeft, ChevronRight,
  Clock, X, Check, AlertCircle, RefreshCw, Trash2, Edit2, Receipt,
  Scissors, Droplets, Stethoscope, Syringe, PawPrint, ClipboardList,
  CheckCircle, Zap, PartyPopper, XCircle, Play, MapPin, Bike, Wallet
} from 'lucide-react'
import { useAppointments } from '../../../shared/hooks/useAppointments'
import { useClients }         from '../../../shared/hooks/useClients'
import { useAuthCtx }      from '../../../context/AuthContext'
import { Card } from '../../../components/ui'
import { fmtCurrency, fmtTime, todayISO } from '../../../lib/supabase'
import { printThermalReceipt } from '../../../lib/thermalPrint'
import { usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import { useCatalogPlans } from '../hooks/useCatalogPlans'
import {
  activeSubscriptionsForClient,
  buildCombinedCatalogUsageSummary,
} from '../lib/catalogPlanServices'
import { groupPetsByTutor } from '../../../shared/lib/petTutorGroups'
import { serviceIcon } from '../lib/petshopTeam'
import {
  normalizeDeliveryStaff,
  normalizeOperationalStaff,
  normalizeServiceDurations,
  PETSHOP_DELIVERY_STAFF_TEMPLATE_KEY,
  resolvePetshopServiceDuration,
} from '../../../../shared/petshopOperations'
import './AgendaPage.css'
import {
  appointmentServiceCodes,
  appointmentServiceGroup,
  appointmentServiceLabel,
  calculateAppointmentServiceTotals,
  classifyAppointmentServiceGroup,
  serviceOptionsForAppointmentGroup,
} from '../lib/appointmentServices'
import {
  MANUAL_SLOT_CAPACITY,
  agendaVisualLaneCount,
  appointmentOccupiesManualSlot,
  appointmentTransportAddress,
  appointmentTransportLabel,
  isMotodogTransportMode,
  layoutAgendaOverlapClusters,
} from '../lib/appointmentOperational'
import { normalizeTransportOptions } from './agendaOperationalCore'
import { appointmentCheckoutTotals, appointmentNeedsPayment, queueAppointmentCheckout } from './appointmentCheckoutFlow'
import { AgendaBillingLabel } from '../components/AgendaBillingLabel'
import { appointmentPackagePresentation } from '../lib/appointmentBillingPresentation'
import { appointmentRequiresGroomingMachineNumber } from '../lib/groomingMachinePolicy'

// ── Helpers ───────────────────────────────────────────────────────────────────
const asAgendaServices = (services = []) =>
  (Array.isArray(services) ? services : []).map((service) => ({
    value: service.code || service.value,
    label: String(service.name || service.label || service.code || 'Servico').trim(),
    price: Number(service.default_price ?? service.price ?? 0),
    duration: Number(service.default_duration_min ?? service.duration ?? 60),
    icon: serviceIcon(service),
    group_type: classifyAppointmentServiceGroup(service),
    active: service.active !== false,
  }))

const SERVICES = []

const AGENDA_TABS = [
  { id: 'banho_tosa', label: 'Banho/Tosa', icon: Scissors },
  { id: 'veterinaria', label: 'Veterinária', icon: Stethoscope },
]

const normalizeServiceType = (type = '') =>
  String(type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const compactText = (value = '') => normalizeServiceType(value).trim()
const safeLower = (value = '') => compactText(value)

const getAppointmentServiceGroup = (appointment, services = SERVICES) =>
  appointmentServiceGroup(
    typeof appointment === 'object' ? appointment : { service_type: appointment },
    services,
  )

const serviceOptionsForGroup = (group, services = SERVICES) =>
  serviceOptionsForAppointmentGroup(services || SERVICES, group)

const fmtAppointmentInterval = (appt) => {
  if (!appt?.scheduled_at) return '-'
  const start = new Date(appt.scheduled_at)
  const duration = Math.max(15, Number(appt.duration_min || 60))
  const end = new Date(start.getTime() + duration * 60 * 1000)
  const f = (d) => d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
  return `${f(start)} - ${f(end)}`
}

const motodogAddressText = (appt) => appointmentTransportAddress(appt)

const motodogDefaultsFromClient = (client = {}) => {
  const appendUnique = (base, value, separator = ', ') => {
    const cleanValue = String(value || '').trim()
    if (!cleanValue) return base
    if (safeLower(base).includes(safeLower(cleanValue))) return base
    return base ? `${base}${separator}${cleanValue}` : cleanValue
  }

  let address = String(client.owner_address || '').trim()
  address = appendUnique(address, client.address_number)
  address = appendUnique(address, client.address_complement, ' - ')
  if (client.zip_code && !safeLower(address).includes(safeLower(client.zip_code))) {
    address = appendUnique(address, `CEP ${client.zip_code}`, ' - ')
  }

  return {
    transport_address: address,
    transport_neighborhood: String(client.owner_neighborhood || '').trim(),
    transport_city: String(client.owner_city || '').trim(),
    transport_reference: String(client.address_reference || '').trim(),
  }
}

const fillMotodogFromClient = (current, client, { overwrite = false } = {}) => {
  const defaults = motodogDefaultsFromClient(client)
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key,
    overwrite ? value : (current[key] || value),
  ]))
}

function MotodogAgendaInfo({ appt, compact = false }) {
  if (!appt?.motodog?.mode) return null
  const address = motodogAddressText(appt)
  const motodog = isMotodogTransportMode(appt.motodog.mode)
  const contactPhone = appt?.pets?.phone || ''
  const contactEmail = appt?.pets?.email || ''
  return (
    <div className={`yuisync-card-transport ${compact ? "mt-1 text-[10px]" : "rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-2 text-[11px]"} ${motodog ? "text-emerald-300" : "text-sky-300"}`}>
      <p className="flex items-center gap-1 font-bold">
        <Bike size={compact ? 10 : 12}/> {appointmentTransportLabel(appt.motodog.mode)}
      </p>
      {motodog && address && (
        <p className="mt-1 flex items-start gap-1 text-muted">
          <MapPin size={compact ? 9 : 11} className="mt-0.5 shrink-0"/>
          <span>{address}</span>
        </p>
      )}
      {motodog && appt.motodog.reference && (
        <p className="mt-1 text-muted">Referencia: {appt.motodog.reference}</p>
      )}
      {motodog && contactPhone && <p className="mt-1 text-muted">Contato: {contactPhone}</p>}
      {motodog && appt.motodog?.staff_name && <p className="mt-1 text-muted">Motoboy: {appt.motodog.staff_name}</p>}
      {motodog && contactEmail && <p className="mt-1 text-muted">E-mail: {contactEmail}</p>}
    </div>
  )
}

const agendaCardTone = (status) => ({
  agendado: 'border-amber-400/35 bg-amber-500/12 text-amber-100',
  confirmado: 'border-blue-400/35 bg-blue-500/12 text-blue-100',
  em_andamento: 'border-violet-400/40 bg-violet-500/14 text-violet-100',
  concluido: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100',
  cancelado: 'border-red-400/25 bg-red-500/10 text-red-100 opacity-70',
  no_show: 'border-red-400/25 bg-red-500/10 text-red-100 opacity-70',
}[status] || 'border-white/12 bg-white/7 text-text')

const serviceLabelFallbackLegacy = (type = '') =>
  SERVICES.find((service) => service.value === type)?.label || String(type || 'Serviço')

const serviceLabelFallback = (type = '', services = SERVICES) =>
  (services || SERVICES).find((service) => service.value === type)?.label || serviceLabelFallbackLegacy(type)

const buildStatsForDate = (items, selectedDate) => {
  const day = isoDate(selectedDate)
  const list = items.filter((appt) => appt.scheduled_at?.startsWith(day))
  return {
    total: list.length,
    agendado: list.filter((appt) => appt.status === 'agendado').length,
    confirmado: list.filter((appt) => appt.status === 'confirmado').length,
    em_andamento: list.filter((appt) => appt.status === 'em_andamento').length,
    concluido: list.filter((appt) => appt.status === 'concluido').length,
    cancelado: list.filter((appt) => appt.status === 'cancelado').length,
  }
}

const STATUSES = [
  { value: 'agendado',      label: 'Agendado'      },
  { value: 'confirmado',    label: 'Confirmado'    },
  { value: 'em_andamento',  label: 'Em andamento'  },
  { value: 'concluido',     label: 'Concluído'     },
  { value: 'cancelado',     label: 'Cancelado'     },
  { value: 'no_show',       label: 'No-show'       },
]

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7))
const AGENDA_HOURS = Array.from({ length: 10 }, (_, i) => i + 8)
const localDateKey = (value) => value ? isoDate(new Date(value)) : ''
const localHour = (value) => value ? new Date(value).getHours() : -1

const appointmentHourSlotKeys = (appt = {}) => {
  if (!appt?.scheduled_at) return []
  const start = new Date(appt.scheduled_at)
  if (Number.isNaN(start.getTime())) return []

  const cursor = new Date(start)
  cursor.setMinutes(0, 0, 0)

  const duration = Math.max(15, Number(appt.duration_min || 60))
  const end = new Date(start.getTime() + duration * 60 * 1000)
  const expandOverlappingHours = appointmentOccupiesManualSlot(appt)
  const keys = []

  do {
    keys.push(`${localDateKey(cursor)}-${cursor.getHours()}`)
    cursor.setHours(cursor.getHours() + 1)
  } while (expandOverlappingHours && cursor < end)

  return keys
}


const DAILY_SLOT_MINUTES = 10
const DAILY_ROW_HEIGHT = 24

const minutesOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 0
  return date.getHours() * 60 + date.getMinutes()
}

const timeFromMinutes = (minutes) => {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Number(minutes || 0)))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

const appointmentIntervalBounds = (appt = {}) => {
  const start = new Date(appt.scheduled_at)
  if (Number.isNaN(start.getTime())) return null
  const duration = Math.max(15, Number(appt.duration_min || 60))
  return { start, end: new Date(start.getTime() + duration * 60 * 1000) }
}

const fmtInterval = (appt) => fmtAppointmentInterval(appt)

const PT_WEEKDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const PT_MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

// ── Modal de Recibo de Serviço ────────────────────────────────────────────────
const escapeReceiptHtml = (value = '') => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

function ReceiptModal({ appt, onClose, serviceLabel, staffById = new Map() }) {
  const { storeSettings } = useAuthCtx()
  const pet = appt.pets || {}
  const assigned = staffById.get(appt.responsible_staff_key)
  const responsible = assigned?.name || appt.responsible_staff_name || 'Nao informado'
  const scheduled = appt.scheduled_at ? new Date(appt.scheduled_at) : null
  const date = scheduled && !Number.isNaN(scheduled.getTime())
    ? scheduled.toLocaleDateString('pt-BR')
    : 'Nao informada'
  const interval = fmtAppointmentInterval(appt)
  const title = appt.status === 'concluido' ? 'FICHA DE ATENDIMENTO' : 'FICHA DE AGENDAMENTO'

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const logoUrl = String(
      storeSettings?.receipt_logo_data_url
      || storeSettings?.store_logo_url
      || storeSettings?.logo_url
      || `${window.location.origin}/brand/quatro-patas-logo-mono.png`,
    )
    const row = (label, value) => `
      <div class="row">
        <div class="label">${escapeReceiptHtml(label)}</div>
        <div class="value">${escapeReceiptHtml(value || 'Nao informado')}</div>
      </div>
    `

    const receiptHtml = `
      <html>
        <head>
          <meta charset="utf-8"/>
          <title>${escapeReceiptHtml(title)}</title>
          <style>
            @page { margin: 0; }
            * { box-sizing: border-box; }
            html, body { width: 80mm; margin: 0; padding: 0; color: #000; background: #fff; }
            body { font-family: Arial, Helvetica, sans-serif; padding: 3mm 0 3mm 2mm; }
            .receipt { width: 64mm; max-width: 64mm; }
            .center { text-align: center; }
            .logo { display: block; width: auto; max-width: 56mm; max-height: 22mm; margin: 0 auto 2.5mm; object-fit: contain; filter: grayscale(1) contrast(2); }
            .title { margin: 3mm 0 2mm; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 1.6mm 0; font-size: 13px; font-weight: 900; }
            .row { display: grid; grid-template-columns: 18mm minmax(0, 1fr); gap: 1.5mm; padding: .8mm 0; border-bottom: 1px dotted #777; font-size: 10.5px; line-height: 1.32; }
            .label { font-size: 9.5px; font-weight: 900; text-transform: uppercase; }
            .value { min-width: 0; font-size: 10.5px; font-weight: 700; white-space: pre-wrap; overflow-wrap: anywhere; }
            .footer { margin-top: 3mm; font-size: 8.5px; line-height: 1.3; }
            @media print { body { position: absolute; inset: 0 auto auto 0; } }
          </style>
        </head>
        <body>
          <main class="receipt">
            <div class="center">
              <img class="logo" src="${escapeReceiptHtml(logoUrl)}" alt="Logo da empresa"/>
              <div class="title">${escapeReceiptHtml(title)}</div>
            </div>
            ${row('Tutor', pet.owner_name)}
            ${row('Pet', pet.pet_name)}
            ${row('Raca', pet.breed || pet.species)}
            ${row('Data e hora', `${date} - ${interval}`)}
            ${row('Servico', serviceLabel(appt))}
            ${row('Resp.', responsible)}
            ${row('Obs.', appt.notes || 'Nenhuma observacao')}
            <div class="footer center">Impresso em ${escapeReceiptHtml(new Date().toLocaleString('pt-BR'))}</div>
          </main>
        </body>
      </html>
    `
    printWindow.document.write(receiptHtml)
    printWindow.document.close()

    let printed = false
    const printWhenReady = () => {
      if (printed) return
      printed = true
      printThermalReceipt(printWindow)
    }
    const images = [...printWindow.document.images]
    const pendingImages = images.filter((image) => !image.complete)
    if (pendingImages.length === 0) {
      window.setTimeout(printWhenReady, 80)
    } else {
      let remaining = pendingImages.length
      const settleImage = () => {
        remaining -= 1
        if (remaining <= 0) window.setTimeout(printWhenReady, 80)
      }
      pendingImages.forEach((image) => {
        image.addEventListener('load', settleImage, { once: true })
        image.addEventListener('error', settleImage, { once: true })
      })
      window.setTimeout(printWhenReady, 1500)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-md">
        <div className="modal-header">
          <h2 className="font-display font-bold text-xl text-text">Ficha 80 mm</h2>
          <button type="button" aria-label="Fechar impressao" title="Fechar" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-5">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-3 text-sm">
            <p><span className="text-muted">Tutor:</span> <strong>{pet.owner_name || 'Nao informado'}</strong></p>
            <p><span className="text-muted">Pet:</span> <strong>{pet.pet_name || 'Nao informado'}</strong></p>
            <p><span className="text-muted">Horario:</span> <strong>{date} · {interval}</strong></p>
            <p><span className="text-muted">Servico:</span> <strong>{serviceLabel(appt)}</strong></p>
            <p><span className="text-muted">Responsavel:</span> <strong>{responsible}</strong></p>
            <p><span className="text-muted">Observacoes:</span> <strong>{appt.notes || 'Nenhuma observacao'}</strong></p>
          </div>
          <button onClick={handlePrint} className="btn btn-primary w-full justify-center gap-2 py-3">
            <Receipt size={16}/> Imprimir ficha
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Modal de Agendamento ──────────────────────────────────────────────────────
function ApptModal({ appt, onClose, onCreate, onUpdate, onReceipt, onRefreshSubscriptions, onManagePets, pets, services = SERVICES, subscriptions = [], staff = [], deliveryStaff = [], transportOptions = [], serviceDurations, onSearchClients, appointments = [], slotCapacity = MANUAL_SLOT_CAPACITY }) {
  const isEdit = !!appt?.id
  const now = new Date()
  const defaultDate = appt?.date || isoDate(now)
  const defaultTime = appt?.time || `${String(now.getHours() + 1).padStart(2, '0')}:00`
  const serviceGroup = isEdit ? getAppointmentServiceGroup(appt, services) : (appt?.serviceGroup || 'banho_tosa')
  const groupOptions = serviceOptionsForGroup(serviceGroup, services)
  const existingCodes = isEdit ? appointmentServiceCodes(appt) : []
  const existingSnapshots = Array.isArray(appt?.service_items) ? appt.service_items : []
  const legacyOptions = existingCodes.map((code) => {
    const catalogService = (services || SERVICES).find((service) => service.value === code)
    if (catalogService) return catalogService
    const snapshot = existingSnapshots.find((item) => item?.code === code) || {}
    return {
      value: code,
      label: snapshot.name || serviceLabelFallback(code, services),
      price: Number(snapshot.unit_price ?? snapshot.price ?? 0),
      duration: Number(snapshot.duration_min || 60),
      group_type: snapshot.group_type || serviceGroup,
      active: true,
      icon: PawPrint,
    }
  })
  const serviceOptions = [...new Map([...groupOptions, ...legacyOptions].map((service) => [service.value, service])).values()]
  const initialServiceCodes = existingCodes.length > 0 ? existingCodes : []
  const serviceGroupLabel = serviceGroup === 'veterinaria' ? 'Servicos veterinarios' : 'Servicos de banho/tosa'
  const staffOptions = normalizeOperationalStaff(staff).filter((person) => person.active)
  const deliveryStaffOptions = normalizeDeliveryStaff(deliveryStaff).filter((person) => person.active)

  const [form, setForm] = useState({
    pet_id: isEdit ? appt.pets?.id || appt.client_id || '' : '',
    pet_search: '',
    service_codes: initialServiceCodes,
    date: isEdit ? appt.scheduled_at?.slice(0, 10) || defaultDate : defaultDate,
    time: isEdit && appt.scheduled_at ? fmtTime(appt.scheduled_at).replace('h', ':') : defaultTime,
    status: isEdit ? appt.status || 'agendado' : 'agendado',
    notes: isEdit ? appt.notes || '' : '',
    responsible_staff_key: isEdit ? appt.responsible_staff_key || '' : '',
    delivery_staff_key: isEdit ? appt.delivery_staff_key || appt.motodog?.staff_key || '' : '',
    transport_mode: isEdit ? appt.motodog?.mode || 'cliente_leva' : 'cliente_leva',
    transport_address: isEdit ? appt.motodog?.address || '' : '',
    transport_neighborhood: isEdit ? appt.motodog?.neighborhood || '' : '',
    transport_city: isEdit ? appt.motodog?.city || '' : '',
    transport_reference: isEdit ? appt.motodog?.reference || '' : '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [clientPickerOpen, setClientPickerOpen] = useState(() => !form.pet_id)
  const [selectedClient, setSelectedClient] = useState(() => appt?.pets || null)
  const [remotePets, setRemotePets] = useState([])
  const [pendingTutorPets, setPendingTutorPets] = useState([])
  const [searchingClients, setSearchingClients] = useState(false)
  const [serviceSearch, setServiceSearch] = useState('')
  const [servicePickerOpen, setServicePickerOpen] = useState(false)
  const [durationOverride, setDurationOverride] = useState(() => isEdit && appt?.duration_min ? String(appt.duration_min) : '')
  const clientPickerRef = useRef(null)
  const clientSearchRef = useRef(null)
  const servicePickerRef = useRef(null)
  const serviceSearchRef = useRef(null)
  const searchRequestRef = useRef(0)
  const petNotesDefaultRef = useRef(isEdit ? String(appt?.notes || '') : '')

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const petSearch = form.pet_search || ''
  const deferredPetSearch = useDeferredValue(petSearch)
  const activeSubscriptions = useMemo(
    () => activeSubscriptionsForClient(subscriptions, form.pet_id),
    [subscriptions, form.pet_id],
  )
  const packageUsage = useMemo(
    () => buildCombinedCatalogUsageSummary(activeSubscriptions, services),
    [activeSubscriptions, services],
  )
  const packageServiceEntries = useMemo(() => packageUsage.filter((item) => (
    item.service_kind === 'catalog'
    && item.catalog_service
    && item.catalog_service.group_type === serviceGroup
    && Number(item.remaining || 0) > 0
  )), [packageUsage, serviceGroup])
  const packageServiceCodes = useMemo(
    () => new Set(packageServiceEntries.map((item) => String(item.service_code || item.service_type))),
    [packageServiceEntries],
  )
  const packageTransport = useMemo(
    () => packageUsage.find((item) => item.service_kind === 'transport' || item.service_type === 'motodog') || null,
    [packageUsage],
  )
  const packageNames = useMemo(() => [...new Set(activeSubscriptions
    .map((subscription) => subscription.subscription_plans?.name)
    .filter(Boolean))], [activeSubscriptions])
  const packageName = activeSubscriptions.length > 1
    ? `${activeSubscriptions.length} pacotes ativos`
    : packageNames[0] || 'Pacote ativo'
  const serviceTotals = useMemo(() => {
    const totals = calculateAppointmentServiceTotals(form.service_codes, serviceOptions)
    const packageAdjustedPrice = totals.services.reduce((sum, service) => (
      sum + (packageServiceCodes.has(String(service.value)) ? 0 : Number(service.price || 0))
    ), 0)
    if (serviceGroup !== 'banho_tosa') return { ...totals, price: packageAdjustedPrice }
    const durations = normalizeServiceDurations(serviceDurations)
    const weightKg = selectedClient?.weight_kg ?? appt?.pets?.weight_kg ?? null
    return {
      ...totals,
      price: packageAdjustedPrice,
      duration: totals.services.reduce((sum, service) => sum + resolvePetshopServiceDuration({
        service,
        weightKg,
        durations,
        fallbackMin: service.duration || 60,
      }), 0),
    }
  }, [form.service_codes, serviceOptions, serviceGroup, serviceDurations, selectedClient?.weight_kg, appt?.pets?.weight_kg, packageServiceCodes])
  const effectiveDuration = Math.max(10, Number(durationOverride || serviceTotals.duration || 0))
  const availableServiceOptions = useMemo(() => {
    const query = safeLower(serviceSearch)
    const selectedCodes = new Set(form.service_codes.map(String))
    return serviceOptions
      .filter((service) => !selectedCodes.has(String(service.value)))
      .filter((service) => !query || safeLower([service.label, service.value].filter(Boolean).join(' ')).includes(query))
      .sort((left, right) => {
        const packagePriority = Number(packageServiceCodes.has(String(right.value))) - Number(packageServiceCodes.has(String(left.value)))
        if (packagePriority !== 0) return packagePriority
        return String(left.label || '').localeCompare(String(right.label || ''), 'pt-BR')
      })
  }, [serviceOptions, form.service_codes, serviceSearch, packageServiceCodes])
  const filteredTutorGroups = useMemo(() => {
    const query = safeLower(deferredPetSearch)
    const unique = new Map()
    ;[...(pets || []), ...remotePets].forEach((pet) => unique.set(pet.id, pet))
    return groupPetsByTutor([...unique.values()])
      .filter((group) => !query || group.pets.some((pet) => safeLower([
        pet.pet_name,
        pet.owner_name,
        pet.phone,
        pet.email,
        pet.breed,
        pet.species,
      ].filter(Boolean).join(' ')).includes(query)))
      .slice(0, 8)
  }, [pets, remotePets, deferredPetSearch])
  const selectedPet = useMemo(() => (
    (selectedClient?.id === form.pet_id ? selectedClient : null)
    || (pets || []).find((pet) => pet.id === form.pet_id)
    || (appt?.pets?.id === form.pet_id ? appt.pets : null)
  ), [selectedClient, pets, form.pet_id, appt?.pets])
  useEffect(() => {
    if (isEdit) return
    const petNotes = String(selectedPet?.notes || '').trim()
    setForm((current) => {
      const currentNotes = String(current.notes || '')
      const previousDefault = petNotesDefaultRef.current
      petNotesDefaultRef.current = petNotes
      if (currentNotes && currentNotes !== previousDefault) return current
      if (currentNotes === petNotes) return current
      return { ...current, notes: petNotes }
    })
  }, [isEdit, selectedPet?.id, selectedPet?.notes])

  const selectedTutorPets = useMemo(() => {
    if (!form.pet_id) return []
    const unique = new Map()
    ;[...(pets || []), ...remotePets, selectedClient].filter(Boolean).forEach((pet) => unique.set(pet.id, pet))
    const group = groupPetsByTutor([...unique.values()]).find((item) => item.pets.some((pet) => pet.id === form.pet_id))
    return group?.pets || []
  }, [pets, remotePets, selectedClient, form.pet_id])

  useEffect(() => {
    const query = petSearch.trim()
    if (!onSearchClients || query.length < 2) {
      searchRequestRef.current += 1
      setRemotePets([])
      setSearchingClients(false)
      return undefined
    }

    const requestId = ++searchRequestRef.current
    const timer = setTimeout(async () => {
      setSearchingClients(true)
      try {
        const results = await onSearchClients(query, { limit: 20 })
        if (searchRequestRef.current === requestId) setRemotePets(results || [])
      } catch (searchError) {
        if (searchRequestRef.current === requestId) console.warn('Falha ao buscar clientes da agenda:', searchError)
      } finally {
        if (searchRequestRef.current === requestId) setSearchingClients(false)
      }
    }, 120)

    return () => clearTimeout(timer)
  }, [petSearch, onSearchClients])

  useEffect(() => {
    if (!clientPickerOpen && !servicePickerOpen) return undefined
    const closePicker = (event) => {
      if (clientPickerOpen && clientPickerRef.current && !clientPickerRef.current.contains(event.target)) {
        setClientPickerOpen(false)
      }
      if (servicePickerOpen && servicePickerRef.current && !servicePickerRef.current.contains(event.target)) {
        setServicePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', closePicker)
    return () => document.removeEventListener('mousedown', closePicker)
  }, [clientPickerOpen, servicePickerOpen])

  const openClientPicker = () => {
    setPendingTutorPets([])
    setClientPickerOpen(true)
    requestAnimationFrame(() => clientSearchRef.current?.focus())
  }

  const selectClient = (pet) => {
    setForm((current) => ({
      ...current,
      pet_id: pet.id,
      pet_search: '',
      ...(isMotodogTransportMode(current.transport_mode)
        ? fillMotodogFromClient(current, pet, { overwrite: true })
        : {}),
    }))
    setSelectedClient(pet)
    setPendingTutorPets([])
    setErr('')
    setClientPickerOpen(false)
  }

  const selectTutor = (group) => {
    const tutorPets = Array.isArray(group?.pets) ? group.pets : []
    if (tutorPets.length === 1) {
      selectClient(tutorPets[0])
      return
    }
    setPendingTutorPets(tutorPets)
    set('pet_search', '')
  }

  const openServicePicker = () => {
    setServicePickerOpen(true)
    requestAnimationFrame(() => serviceSearchRef.current?.focus())
  }

  const addService = (serviceCode) => {
    setForm((current) => ({
      ...current,
      service_codes: current.service_codes.includes(serviceCode)
        ? current.service_codes
        : [...current.service_codes, serviceCode],
    }))
    setServiceSearch('')
    setServicePickerOpen(false)
    setErr('')
  }

  const addPackageServices = () => {
    const codes = packageServiceEntries.map((item) => String(item.service_code || item.service_type)).filter(Boolean)
    if (!codes.length) return setErr('O pacote ativo não possui serviço disponível nesta aba.')
    setForm((current) => ({
      ...current,
      service_codes: [...new Set([...current.service_codes, ...codes])],
    }))
    setServiceSearch('')
    setServicePickerOpen(false)
    setErr('')
  }

  const removeService = (serviceCode) => {
    setForm((current) => ({
      ...current,
      service_codes: current.service_codes.filter((code) => code !== serviceCode),
    }))
    setErr('')
  }

  async function handleSubmit() {
    if (!form.pet_id) return setErr('Selecione um cliente/pet')
    if (!form.service_codes.length) return setErr('Selecione pelo menos um servico')
    if (!form.date) return setErr('Informe a data')
    if (!form.time) return setErr('Informe o horario')
    if (!serviceTotals.services.length) return setErr('Os servicos selecionados nao estao mais disponiveis')

    const candidateStart = new Date(`${form.date}T${form.time}:00`)
    if (Number.isNaN(candidateStart.getTime())) return setErr('Horario invalido')
    setSaving(true)
    setErr('')
    try {
      const scheduled_at = candidateStart.toISOString()
      const payload = {
        pet_id: form.pet_id,
        service_type: form.service_codes[0],
        services: form.service_codes.map((code) => ({ code })),
        service_group: serviceGroup,
        scheduled_at,
        duration_min: effectiveDuration,
        price: serviceTotals.price,
        status: form.status,
        notes: form.notes,
        responsible_staff_key: form.responsible_staff_key || null,
        responsible_staff_name: staffOptions.find((person) => person.key === form.responsible_staff_key)?.name || null,
        delivery_staff_key: isMotodogTransportMode(form.transport_mode) ? (form.delivery_staff_key || null) : null,
        delivery_staff_name: isMotodogTransportMode(form.transport_mode) ? deliveryStaffOptions.find((person) => person.key === form.delivery_staff_key)?.name || null : null,
        transport_mode: form.transport_mode || 'cliente_leva',
        transport_label: appointmentTransportLabel(form.transport_mode),
        transport_address: isMotodogTransportMode(form.transport_mode) ? form.transport_address || null : null,
        transport_neighborhood: isMotodogTransportMode(form.transport_mode) ? form.transport_neighborhood || null : null,
        transport_city: isMotodogTransportMode(form.transport_mode) ? form.transport_city || null : null,
        transport_reference: isMotodogTransportMode(form.transport_mode) ? form.transport_reference || null : null,
        source: 'manual',
      }
      if (isEdit) await onUpdate(appt.id, payload)
      else await onCreate(payload)
      await onRefreshSubscriptions?.()
      onClose()
    } catch (error) {
      setErr(error.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-2xl">
        <div className="modal-header">
          <h2 className="font-display font-bold text-xl text-text">
            {isEdit ? 'Editar Agendamento' : 'Novo Agendamento'}
          </h2>
          <button type="button" aria-label="Fechar agendamento" title="Fechar" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>

        <div className="modal-body">
          <div className="space-y-6">
            <div ref={clientPickerRef} className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inp-label mb-0 flex items-center gap-2"><Plus size={14}/> Selecionar cliente e pet</label>
                {onManagePets && <button type="button" onClick={onManagePets} className="btn btn-ghost btn-sm"><PawPrint size={13}/> Gerenciar clientes e pets</button>}
              </div>
              {!clientPickerOpen && selectedPet ? (
                <button
                  type="button"
                  onClick={openClientPicker}
                  className="w-full rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-amber-500/15 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-text truncate">{selectedPet.owner_name || 'Cliente sem nome'}</span>
                    <span className="block text-xs text-muted truncate">
                      {selectedTutorPets.length > 1
                        ? `Pet selecionado: ${selectedPet.pet_name || 'sem nome'} · ${selectedTutorPets.length} pets no cadastro`
                        : [selectedPet.pet_name, selectedPet.breed || selectedPet.species, selectedPet.phone].filter(Boolean).join(' - ') || 'Cadastro sem pet informado'}
                    </span>
                  </span>
                  <span className="text-[11px] font-bold text-amber-400 flex-shrink-0">Alterar</span>
                </button>
              ) : !clientPickerOpen ? (
                <button type="button" onClick={openClientPicker} className="btn btn-secondary w-full justify-center">
                  <Search size={14}/> Buscar cliente ou pet
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"/>
                    <input
                      ref={clientSearchRef}
                      aria-label="Buscar cliente ou pet"
                      className="inp pl-9 py-2 text-xs"
                      placeholder="Buscar cliente, pet ou telefone..."
                      value={form.pet_search}
                      onChange={(event) => set('pet_search', event.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div role="listbox" aria-label="Resultados de clientes" className="max-h-64 rounded-xl border border-[var(--border2)] bg-surface/60 overflow-y-auto">
                    {pendingTutorPets.length > 1 ? (
                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-text">Escolha o pet para este agendamento</p>
                            <p className="text-[11px] text-muted">{pendingTutorPets[0]?.owner_name || 'Cliente'} possui {pendingTutorPets.length} pets ativos.</p>
                          </div>
                          <button type="button" onClick={() => setPendingTutorPets([])} className="btn btn-ghost btn-sm">Voltar</button>
                        </div>
                        {pendingTutorPets.map((pet) => (
                          <button
                            type="button"
                            key={pet.id}
                            onClick={() => selectClient(pet)}
                            className="w-full rounded-xl border border-[var(--border2)] px-3 py-2 text-left hover:bg-amber-500/10"
                          >
                            <span className="block text-sm font-bold text-text">{pet.pet_name || 'Pet sem nome'}</span>
                            <span className="block text-[11px] text-muted">{[pet.breed || pet.species, pet.weight_kg ? `${pet.weight_kg} kg` : ''].filter(Boolean).join(' - ')}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <>
                        {filteredTutorGroups.map((group) => {
                          const active = group.pets.some((pet) => form.pet_id === pet.id)
                          const petNames = group.pets.map((pet) => pet.pet_name || 'Pet sem nome').join(', ')
                          return (
                            <button
                              type="button"
                              role="option"
                              aria-selected={active}
                              key={group.key}
                              onClick={() => selectTutor(group)}
                              className={`w-full px-3 py-2 text-left flex items-center justify-between gap-3 border-b border-[var(--border2)] last:border-b-0 transition-colors ${
                                active ? 'bg-amber-500/15 text-text' : 'hover:bg-white/5 text-muted'
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block text-xs font-bold text-text truncate">{group.owner_name || 'Cliente sem nome'}</span>
                                <span className="block text-[11px] truncate">
                                  {group.pets.length === 1
                                    ? [petNames, group.pets[0]?.breed || group.pets[0]?.species, group.phone].filter(Boolean).join(' - ')
                                    : `${group.pets.length} pets: ${petNames}`}
                                </span>
                              </span>
                              {group.pets.length > 1
                                ? <span className="text-[10px] font-bold text-amber-400">Escolher pet</span>
                                : active && <Check size={14} className="text-amber-400 flex-shrink-0"/>}
                            </button>
                          )
                        })}
                        {filteredTutorGroups.length === 0 && (
                          <p className="px-3 py-3 text-xs text-muted">Nenhum cliente encontrado com essa busca.</p>
                        )}
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-muted">
                    {searchingClients
                      ? 'Buscando mais clientes...'
                      : deferredPetSearch
                        ? 'Mostrando ate 8 resultados.'
                        : 'Digite um nome, pet ou telefone para refinar a lista.'}
                  </p>
                </div>
              )}
            </div>

            <div ref={servicePickerRef}>
              <label className="inp-label">{serviceGroupLabel}</label>
              {serviceGroup === 'banho_tosa' && activeSubscriptions.length > 0 && (
                <section data-yuisync-native-package-panel className="mb-3 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Pacote ativo · prioridade</p>
                      <p className="mt-1 text-base font-black text-text">{packageName}</p>
                      {packageNames.length > 1 && (
                        <p className="mt-1 text-xs text-emerald-200">{packageNames.join(' + ')}</p>
                      )}
                      <p className="mt-1 text-xs text-muted">{selectedPet?.pet_name || 'Pet'} · Tutor: {selectedPet?.owner_name || 'Cliente'}</p>
                    </div>
                    <span className="badge badge-green">Agenda nativa v1</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {packageUsage.map((item) => (
                      <span key={item.service_type} className={`badge ${Number(item.remaining || 0) > 0 ? 'badge-blue' : 'badge-gray'}`}>
                        {item.label}: {item.remaining}/{item.total} disponíveis
                      </span>
                    ))}
                  </div>
                  {packageTransport && Number(packageTransport.remaining || 0) > 0 && (
                    <p className="mt-2 text-xs font-semibold text-sky-300">MotoDog disponível: {packageTransport.remaining}/{packageTransport.total}. O transporte só é consumido quando selecionado abaixo.</p>
                  )}
                  {packageServiceEntries.length > 0 ? (
                    <>
                      <button type="button" onClick={addPackageServices} className="btn btn-primary mt-3 w-full justify-center">
                        Usar {packageName}
                      </button>
                      <div className="mt-3 space-y-2">
                        {packageServiceEntries.map((entry) => (
                          <button
                            key={entry.service_type}
                            type="button"
                            onClick={() => addService(String(entry.service_code || entry.service_type))}
                            className="flex w-full items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-left hover:bg-emerald-500/15"
                          >
                            <CheckCircle size={15} className="shrink-0 text-emerald-300"/>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-text">{entry.label}</span>
                              <span className="block text-xs text-muted">{entry.remaining} disponível(is) · R$ 0,00</span>
                            </span>
                            <span className="badge badge-green">Pacote</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">O pacote está ativo, mas não possui serviço de banho/tosa disponível neste ciclo.</p>
                  )}
                </section>
              )}
              {serviceGroup === 'banho_tosa' && selectedPet && activeSubscriptions.length === 0 && (
                <div className="mb-3 rounded-xl border border-[var(--border2)] bg-white/[0.03] px-4 py-3 text-xs text-muted">
                  <strong className="text-text">{selectedPet.pet_name || 'Este pet'}</strong> não possui pacote ativo. Os serviços selecionados serão cobrados como atendimento avulso.
                </div>
              )}
              {serviceOptions.length === 0 ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  Nenhum servico real esta classificado nesta aba. Revise a area do servico no cadastro.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <div className="flex overflow-hidden rounded-xl border border-[var(--border2)] bg-white/5 focus-within:border-amber-400/45 focus-within:ring-2 focus-within:ring-amber-400/10">
                      <button
                        type="button"
                        aria-label="Adicionar outro servico"
                        title="Adicionar servico"
                        onClick={openServicePicker}
                        className="flex w-11 flex-shrink-0 items-center justify-center border-r border-[var(--border2)] text-amber-400 hover:bg-amber-500/10"
                      >
                        <Plus size={17}/>
                      </button>
                      <div className="relative min-w-0 flex-1">
                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"/>
                        <input
                          ref={serviceSearchRef}
                          aria-label="Buscar servico para adicionar"
                          className="h-11 w-full bg-transparent pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted"
                          placeholder="Buscar e adicionar servico..."
                          value={serviceSearch}
                          onFocus={() => setServicePickerOpen(true)}
                          onChange={(event) => {
                            setServiceSearch(event.target.value)
                            setServicePickerOpen(true)
                          }}
                          autoComplete="off"
                        />
                      </div>
                    </div>

                    {servicePickerOpen && (
                      <div role="listbox" aria-label="Servicos encontrados" className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--border2)] bg-surface shadow-2xl">
                        {availableServiceOptions.map((service) => {
                          const Icon = service.icon || PawPrint
                          const coveredByPackage = packageServiceCodes.has(String(service.value))
                          return (
                            <button
                              key={service.value}
                              type="button"
                              role="option"
                              aria-selected="false"
                              onClick={() => addService(service.value)}
                              className={`flex w-full items-center gap-3 border-b border-[var(--border2)] px-3 py-2.5 text-left transition-colors last:border-b-0 ${coveredByPackage ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-white/7'}`}
                            >
                              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400"><Icon size={14}/></span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-text">{service.label}</span>
                                <span className={`block text-xs ${coveredByPackage ? 'font-semibold text-emerald-300' : 'text-muted'}`}>{coveredByPackage ? 'Pacote · R$ 0,00' : fmtCurrency(service.price)} · {service.duration || 60} min</span>
                              </span>
                              {coveredByPackage ? <span className="badge badge-green">Pacote</span> : <Plus size={15} className="flex-shrink-0 text-amber-400"/>}
                            </button>
                          )
                        })}
                        {availableServiceOptions.length === 0 && (
                          <p className="px-3 py-3 text-xs text-muted">
                            {form.service_codes.length === serviceOptions.length
                              ? 'Todos os servicos desta area ja foram adicionados.'
                              : 'Nenhum servico encontrado nesta busca.'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {serviceTotals.services.length > 0 ? (
                    <div className="divide-y divide-[var(--border2)] overflow-hidden rounded-xl border border-[var(--border2)] bg-white/[0.03]">
                      {serviceTotals.services.map((service) => {
                        const Icon = service.icon || PawPrint
                        const displayedDuration = resolvePetshopServiceDuration({
                          service,
                          weightKg: selectedClient?.weight_kg ?? appt?.pets?.weight_kg ?? null,
                          durations: serviceDurations,
                          fallbackMin: service.duration || 60,
                        })
                        return (
                          <div key={service.value} className="flex items-center gap-3 px-3 py-2.5">
                            <Icon size={14} className="flex-shrink-0 text-amber-400"/>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-text">{service.label}</span>
                              <span className="block text-xs text-muted">{packageServiceCodes.has(String(service.value)) ? 'Pacote · R$ 0,00' : fmtCurrency(service.price)} · {displayedDuration} min</span>
                            </span>
                            <button
                              type="button"
                              aria-label={`Remover ${service.label}`}
                              title="Remover servico"
                              onClick={() => removeService(service.value)}
                              className="rounded-lg p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400"
                            >
                              <X size={14}/>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-[var(--border2)] px-3 py-3 text-xs text-muted">
                      Nenhum servico adicionado. Use a busca acima para selecionar apenas itens cadastrados nesta area.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="inp-label">Status da visita</label>
                <select aria-label="Status do agendamento" className="inp" value={form.status} onChange={(event) => set('status', event.target.value)}>
                  {STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </div>
              <div>
                <label className="inp-label">Responsavel pelo servico</label>
                <select aria-label="Responsavel pelo atendimento" className="inp" value={form.responsible_staff_key} onChange={(event) => set('responsible_staff_key', event.target.value)}>
                  <option value="">Sem responsavel</option>
                  {staffOptions.map((person) => (
                    <option key={person.key} value={person.key}>{person.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 md:col-span-2 bg-surface/80 border border-[var(--border)] rounded-2xl p-5">
                <div>
                  <label className="inp-label">Data reservada</label>
                  <input aria-label="Data do agendamento" className="inp" type="date" value={form.date} onChange={(event) => set('date', event.target.value)}/>
                </div>
                <div>
                  <label className="inp-label">Inicio</label>
                  <input aria-label="Horario do agendamento" className="inp" type="time" value={form.time} onChange={(event) => set('time', event.target.value)}/>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-white/5 px-4 py-3">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted">Duracao total (min)</label>
                <input
                  aria-label="Duracao total do agendamento"
                  className="inp mt-2"
                  type="number"
                  min="10"
                  step="10"
                  value={durationOverride || serviceTotals.duration || ''}
                  onChange={(event) => setDurationOverride(event.target.value)}
                />
                <p className="mt-1 text-[10px] text-muted">Pre-setada pelo porte e tipo de servico. Pode ser alterada para este agendamento.</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">Valor total</span>
                <strong className="mt-1 block text-lg text-emerald-400">{fmtCurrency(serviceTotals.price)}</strong>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-surface/70 p-5 space-y-4">
              <div>
                <label className="inp-label">Transporte do pet</label>
                <select
                  aria-label="Transporte do pet"
                  className="inp"
                  value={form.transport_mode}
                  onChange={(event) => {
                    const mode = event.target.value
                    setForm((current) => ({
                      ...current,
                      transport_mode: mode,
                      delivery_staff_key: isMotodogTransportMode(mode) ? current.delivery_staff_key : '',
                      ...(isMotodogTransportMode(mode) && selectedPet
                        ? fillMotodogFromClient(current, selectedPet)
                        : {}),
                    }))
                  }}
                >
                  <option value="cliente_leva">Cliente traz e busca</option>
                  <option value="buscar_e_levar">MotoDog - buscar e levar</option>
                  <option value="buscar_e_levar_fora_muriae">MotoDog - buscar e levar (fora de Muriaé)</option>
                  <option value="somente_buscar">MotoDog - somente buscar</option>
                  <option value="somente_levar">MotoDog - somente levar</option>
                </select>
              </div>

              {isMotodogTransportMode(form.transport_mode) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div className="md:col-span-2"><label className="inp-label">Motoboy responsavel</label><select className="inp" value={form.delivery_staff_key} onChange={(event) => set('delivery_staff_key', event.target.value)}><option value="">Definir depois</option>{deliveryStaffOptions.map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}</select>{deliveryStaffOptions.length === 0 && <p className="mt-1 text-xs text-amber-400">Cadastre o motoboy em Configuracoes &gt; Geral.</p>}</div>
                  <div className="md:col-span-2">
                    <label className="inp-label">Rua e numero</label>
                    <input className="inp" value={form.transport_address} onChange={(event) => set('transport_address', event.target.value)} placeholder="Rua, numero e complemento"/>
                  </div>
                  <div>
                    <label className="inp-label">Bairro</label>
                    <input className="inp" value={form.transport_neighborhood} onChange={(event) => set('transport_neighborhood', event.target.value)}/>
                  </div>
                  <div>
                    <label className="inp-label">Cidade</label>
                    <input className="inp" value={form.transport_city} onChange={(event) => set('transport_city', event.target.value)}/>
                  </div>
                  <div className="md:col-span-2">
                    <label className="inp-label">Ponto de referencia</label>
                    <input className="inp" value={form.transport_reference} onChange={(event) => set('transport_reference', event.target.value)}/>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="inp-label">Instrucoes e especificacoes para o profissional</label>
              <textarea
                aria-label="Observacoes do agendamento"
                className="inp h-24 resize-none p-4"
                placeholder="Ex: alergias, comportamento ou observacoes importantes..."
                value={form.notes}
                onChange={(event) => set('notes', event.target.value)}
              />
              {selectedPet?.notes && <p className="mt-2 text-xs text-muted">Pré-preenchido com as observações do pet. Você pode complementar sem alterar o cadastro permanente.</p>}
            </div>

            {err && (
              <p className="text-sm bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
                <AlertCircle size={14}/> {err}
              </p>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              {isEdit && appt.status === 'concluido' && (
                <button type="button" onClick={() => onReceipt(appt)} className="btn btn-secondary justify-center">
                  <Receipt size={15}/> Imprimir ficha
                </button>
              )}
              <button onClick={onClose} className="btn btn-secondary flex-1 justify-center">Descartar</button>
              <button onClick={handleSubmit} disabled={saving || serviceOptions.length === 0} className="btn btn-primary flex-1 justify-center shadow-lg">
                {saving ? 'Confirmando...' : isEdit ? 'Salvar alteracoes' : 'Confirmar reserva'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Coluna de Status (Kanban) ──────────────────────────────────────────────────
function KanbanCard({ appt, serviceLabel, statusBadge, onEdit, onStatus, onReceipt, onCompletedAction, needsPayment, services = SERVICES, staffById = new Map() }) {
  const sb = statusBadge(appt.status)
  const assigned = staffById.get(appt.responsible_staff_key)
  return (
    <div className="bg-surface border border-[var(--border)] rounded-xl p-3.5 space-y-2.5 hover:border-amber-500/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-text text-sm">{appt.pets?.pet_name || '—'}</p>
          <p className="text-xs text-muted">{appt.pets?.owner_name}</p>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {appt.status === 'concluido' && (
            <button type="button" aria-label={needsPayment(appt) ? 'Receber atendimento' : 'Imprimir ficha'} onClick={() => onCompletedAction(appt)} className="text-muted hover:text-emerald-400" title={needsPayment(appt) ? 'Receber e lancar no caixa' : 'Imprimir ficha'}>
              {needsPayment(appt) ? <Wallet size={13}/> : <Receipt size={13}/>}
            </button>
          )}
            <button type="button" aria-label="Editar agendamento" title="Editar" onClick={() => onEdit(appt)} className="text-muted hover:text-amber-400">
            <Edit2 size={13}/>
          </button>
        </div>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted">
        <Clock size={11} className="mt-0.5 flex-shrink-0"/>
        <div>
          <p className="text-amber-400 font-bold leading-none">{fmtInterval(appt)}</p>
          <p className="mt-1 opacity-70 flex items-center gap-1">
             {(() => {
               const firstCode = appointmentServiceCodes(appt)[0]
               const selectedService = (services || SERVICES).find((item) => item.value === firstCode)
               const Icon = selectedService?.icon || PawPrint
               return <><Icon size={10}/> {serviceLabel(appt)}</>
             })()}
          </p>
          <p className={`mt-1 ${assigned ? 'text-muted' : 'text-amber-400'}`}>
            {assigned ? `Resp.: ${assigned.name}` : appt.responsible_staff_name ? `Resp.: ${appt.responsible_staff_name}` : 'Sem responsavel'}
          </p>
        </div>
      </div>
      <MotodogAgendaInfo appt={appt}/>
      {appt.notes && <p className="whitespace-pre-wrap rounded-lg border border-amber-500/20 bg-amber-500/8 px-2.5 py-2 text-xs text-amber-100"><ClipboardList size={12} className="mr-1 inline"/> {appt.notes}</p>}
      <div className="flex items-center justify-between">
        <span className={`badge ${sb.cls} text-[10px]`}>{sb.label}</span>
        <span className="text-xs font-semibold text-emerald-400">{fmtCurrency(appt.price)}</span>
      </div>
      {/* Quick status actions */}
      <div className="flex gap-1.5 pt-1">
        {appt.status === 'agendado' && (
          <button onClick={() => onStatus(appt.id, 'confirmado')}
            className="btn btn-success btn-sm flex-1 justify-center text-[10px] py-1">
            <Check size={10}/> Confirmar
          </button>
        )}
        {appt.status === 'confirmado' && (
          <button onClick={() => onStatus(appt.id, 'em_andamento')}
            className="btn btn-secondary btn-sm flex-1 justify-center text-[10px] py-1 gap-1">
            <Play size={10}/> Iniciar
          </button>
        )}
        {appt.status === 'em_andamento' && (
          <button onClick={() => onStatus(appt.id, 'concluido')}
            className="btn btn-success btn-sm flex-1 justify-center text-[10px] py-1">
            ✓ Concluir
          </button>
        )}
        {['agendado','confirmado'].includes(appt.status) && (
          <button type="button" aria-label="Cancelar agendamento" title="Cancelar agendamento" onClick={() => onStatus(appt.id, 'cancelado')}
            className="btn btn-danger btn-sm justify-center text-[10px] py-1 px-2">
            <X size={10}/>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Página Principal ──────────────────────────────────────────────────────────
function AgendaTimelineView({
  days,
  selectedDate,
  appointments,
  serviceLabel,
  statusBadge,
  staffById,
  onEdit,
  onReceipt,
  onCompletedAction,
  needsPayment,
  onCreateAt,
  onSelectDate,
  slotCapacity = MANUAL_SLOT_CAPACITY,
}) {
  const selectedKey = isoDate(selectedDate)
  const hours = useMemo(() => {
    const appointmentHours = (appointments || [])
      .map((appt) => localHour(appt.scheduled_at))
      .filter((hour) => hour >= 0 && hour <= 23)
    const min = Math.min(AGENDA_HOURS[0], ...(appointmentHours.length ? appointmentHours : [AGENDA_HOURS[0]]))
    const max = Math.max(AGENDA_HOURS[AGENDA_HOURS.length - 1], ...(appointmentHours.length ? appointmentHours : [AGENDA_HOURS[AGENDA_HOURS.length - 1]]))
    return Array.from({ length: max - min + 1 }, (_, index) => min + index)
  }, [appointments])

  const bySlot = useMemo(() => {
    const map = new Map()
    ;(appointments || []).forEach((appt) => {
      appointmentHourSlotKeys(appt).forEach((key) => {
        const list = map.get(key) || []
        list.push(appt)
        map.set(key, list)
      })
    })
    map.forEach((list) => list.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
    return map
  }, [appointments])

  const appointmentCard = (appt) => {
    const sb = statusBadge(appt.status)
    const assigned = staffById.get(appt.responsible_staff_key)
    const billingPresentation = appointmentPackagePresentation(appt)
    return (
      <div
        key={appt.id}
        data-yuisync-native-agenda-card="true"
        data-yuisync-native-appointment-id={String(appt.id)}
        data-yuisync-card-kind={billingPresentation.cardKind}
        data-yuisync-benefit-state={billingPresentation.benefitState || ''}
        data-yuisync-requires-machine-number={String(appointmentRequiresGroomingMachineNumber(appt))}
        className={`yuisync-agenda-card-surface relative w-full rounded-lg border p-2 text-left shadow-sm ${agendaCardTone(appt.status)}`}
      >
        <button type="button" onClick={() => onEdit(appt)} className="yuisync-card-content w-full text-left">
          <div className="yuisync-card-header flex min-w-0 flex-wrap items-start gap-1">
            <p className="yuisync-card-time shrink-0 whitespace-nowrap text-[10px] font-black leading-tight">{fmtAppointmentInterval(appt)}</p>
            <span className={`yuisync-card-status badge ${sb.cls} max-w-full truncate text-[9px]`}>{sb.label}</span>
          </div>
          <div className="yuisync-card-body min-w-0">
            <p className="yuisync-card-pet truncate text-xs font-bold text-text">{appt.pets?.pet_name || 'Pet'}</p>
            <p className="yuisync-card-tutor truncate text-[11px] font-semibold text-text/90">Tutor: {appt.pets?.owner_name || 'Cliente'}</p>
            <div className="yuisync-card-service flex items-center justify-between gap-2 text-[10px] text-muted">
              <span className="truncate">{serviceLabel(appt)}</span>
              <AgendaBillingLabel appointment={appt}/>
            </div>
            <MotodogAgendaInfo appt={appt} compact/>
            <p className={`yuisync-card-responsible truncate text-[10px] ${assigned ? "text-muted" : "text-amber-300"}`}>
              {assigned ? `Resp.: ${assigned.name}` : appt.responsible_staff_name ? `Resp.: ${appt.responsible_staff_name}` : 'Sem responsavel'}
            </p>
          </div>
        </button>
        {appt.status === 'concluido' && (
          <button
            type="button"
            aria-label="Imprimir ficha do agendamento"
            title="Imprimir ficha 80 mm"
            onClick={() => onReceipt(appt)}
            className="absolute right-1.5 top-1.5 rounded-md bg-black/20 p-1 text-emerald-300 hover:bg-black/35"
          >
            <Receipt size={11}/>
          </button>
        )}
      </div>
    )
  }

  if (days.length === 1) {
    const day = days[0]
    const dayKey = isoDate(day)
    const dayItems = (appointments || [])
      .filter((appt) => localDateKey(appt.scheduled_at) === dayKey)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    const blocking = dayItems.filter(appointmentOccupiesManualSlot)
    const history = dayItems.filter((item) => !appointmentOccupiesManualSlot(item))
    const blockingBounds = blocking.map(appointmentIntervalBounds).filter(Boolean)
    const earliestMinute = Math.min(8 * 60, ...(blockingBounds.length ? blockingBounds.map((bounds) => minutesOfDay(bounds.start)) : [8 * 60]))
    const latestMinute = Math.max(18 * 60, ...(blockingBounds.length ? blockingBounds.map((bounds) => minutesOfDay(bounds.end)) : [18 * 60]))
    const rangeStart = Math.floor(earliestMinute / DAILY_SLOT_MINUTES) * DAILY_SLOT_MINUTES
    const rangeEnd = Math.ceil(latestMinute / DAILY_SLOT_MINUTES) * DAILY_SLOT_MINUTES
    const slotCount = Math.max(1, Math.ceil((rangeEnd - rangeStart) / DAILY_SLOT_MINUTES))
    const slots = Array.from({ length: slotCount }, (_, index) => rangeStart + index * DAILY_SLOT_MINUTES)
    const timelineHeight = slots.length * DAILY_ROW_HEIGHT
    const positioned = layoutAgendaOverlapClusters(blocking, appointmentIntervalBounds)

    return (
      <div className="bg-card border border-[var(--border)] rounded-xl2 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div>
            <p className="text-sm font-bold text-text">Agenda diaria em intervalos de 10 minutos</p>
            <p className="text-xs text-muted">{day.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Horários disponíveis
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="yuisync-agenda-daily-grid grid" style={{ gridTemplateColumns: '76px minmax(0, 1fr)' }}>
            <div className="relative bg-surface/35" style={{ height: timelineHeight }}>
              {slots.map((minute, index) => (
                <div
                  key={`label-${minute}`}
                  className="absolute inset-x-0 border-b border-[var(--border)] px-2 text-[10px] font-bold text-muted"
                  style={{ top: index * DAILY_ROW_HEIGHT, height: DAILY_ROW_HEIGHT }}
                >
                  <span className="relative top-1">{timeFromMinutes(minute)}</span>
                </div>
              ))}
            </div>

            <div className="relative border-l border-[var(--border)]" style={{ height: timelineHeight }}>
              {slots.map((minute, index) => (
                <button
                  key={`slot-${minute}`}
                  type="button"
                  aria-label={`Agendar as ${timeFromMinutes(minute)}`}
                  title={`Novo agendamento as ${timeFromMinutes(minute)}`}
                  onClick={() => onCreateAt(day, timeFromMinutes(minute))}
                  className="absolute inset-x-0 border-b border-[var(--border)] text-left hover:bg-emerald-500/[0.04]"
                  style={{ top: index * DAILY_ROW_HEIGHT, height: DAILY_ROW_HEIGHT }}
                />
              ))}

              {positioned.map(({ item: appt, bounds, lane, laneCount }) => {
                if (!bounds) return null
                const startMinute = minutesOfDay(bounds.start)
                const endMinute = minutesOfDay(bounds.end)
                const top = ((startMinute - rangeStart) / DAILY_SLOT_MINUTES) * DAILY_ROW_HEIGHT + 2
                const height = Math.max(34, ((endMinute - startMinute) / DAILY_SLOT_MINUTES) * DAILY_ROW_HEIGHT - 4)
                const laneWidth = 100 / Math.max(1, laneCount)
                return (
                  <div
                    key={appt.id}
                    className="absolute z-10 overflow-hidden rounded-lg"
                    style={{
                      top,
                      height,
                      left: `calc(${lane * laneWidth}% + 4px)`,
                      width: `calc(${laneWidth}% - 8px)`,
                    }}
                  >
                    {appointmentCard(appt)}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {history.length > 0 && (
          <div className="border-t border-[var(--border)] p-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted">Historico do dia</p>
            <div className="grid gap-2 md:grid-cols-2">
              {history.map((appt) => {
                return (
                  <div key={appt.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted">
                    <button type="button" onClick={() => onEdit(appt)} className="min-w-0 flex-1 truncate text-left hover:text-text">
                      {fmtAppointmentInterval(appt)} · {appt.pets?.pet_name || 'Pet'} · {statusBadge(appt.status).label}
                    </button>
                    <button
                      type="button"
                      aria-label="Imprimir ficha do historico"
                      title="Imprimir ficha 80 mm"
                      onClick={() => onReceipt(appt)}
                      className="shrink-0 rounded-md p-1.5 text-emerald-300 hover:bg-emerald-500/15"
                    >
                      <Receipt size={13}/>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-card border border-[var(--border)] rounded-xl2 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
        <div>
          <p className="text-sm font-bold text-text">Agenda {days.length === 1 ? 'diaria' : 'semanal'}</p>
          <p className="text-xs text-muted">
            {days.length === 1 ? (
              days[0]?.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
            ) : (
              <>
                {days[0]?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                {' ate '}
                {days[days.length - 1]?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          Horários disponíveis
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className={days.length === 1 ? 'min-w-[520px]' : 'min-w-[1160px]'}>
          <div className="grid border-b border-[var(--border)] bg-surface/50" style={{ gridTemplateColumns: `76px repeat(${days.length}, minmax(${days.length === 1 ? '360px' : '250px'}, 1fr))` }}>
            <div className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-muted">Hora</div>
            {days.map((day) => {
              const key = isoDate(day)
              const isSelected = key === selectedKey
              const dayCount = (appointments || []).filter((appt) => localDateKey(appt.scheduled_at) === key).length
              return (
                <button key={key} type="button" onClick={() => onSelectDate(day)} className={`text-left px-3 py-3 border-l border-[var(--border)] transition-colors ${isSelected ? "bg-amber-500/14" : "hover:bg-white/5"}`}>
                  <p className={`text-xs font-black uppercase tracking-widest ${isSelected ? "text-amber-300" : "text-muted"}`}>{PT_WEEKDAYS[day.getDay()]}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-lg font-display font-black text-text">{String(day.getDate()).padStart(2, '0')}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isSelected ? "bg-amber-500 text-gray-950" : "bg-white/8 text-muted"}`}>{dayCount}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {hours.map((hour) => (
            <div key={hour} className="grid border-b border-[var(--border)] last:border-b-0" style={{ gridTemplateColumns: `76px repeat(${days.length}, minmax(${days.length === 1 ? '360px' : '250px'}, 1fr))` }}>
              <div className="px-3 py-3 text-xs font-bold text-muted bg-surface/35">{String(hour).padStart(2, '0')}:00</div>
              {days.map((day) => {
                const dayKey = isoDate(day)
                const slotItems = bySlot.get(`${dayKey}-${hour}`) || []
                const occupying = slotItems.filter(appointmentOccupiesManualSlot)
                const nonBlocking = slotItems.filter((item) => !appointmentOccupiesManualSlot(item))
                const visualLaneCount = agendaVisualLaneCount(occupying.length)
                const lanes = Array.from({ length: visualLaneCount }, (_, index) => occupying[index] || null)
                return (
                  <div key={`${dayKey}-${hour}`} className="min-h-[118px] border-l border-[var(--border)] p-2 hover:bg-white/[0.03] transition-colors">
                    <div className="overflow-x-auto">
                      <div
                        className="grid gap-2"
                        style={{
                          gridTemplateColumns: `repeat(${visualLaneCount}, minmax(0, 1fr))`,
                          width: '100%',
                        }}
                      >
                      {lanes.map((appt, laneIndex) => appt ? appointmentCard(appt) : (
                        <button
                          key={`available-${laneIndex}`}
                          type="button"
                          onClick={() => onCreateAt(day, hour)}
                          className="min-h-[92px] rounded-lg border border-dashed border-emerald-500/25 bg-emerald-500/[0.04] px-2 py-3 text-center text-[10px] font-bold text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/10"
                        >
                          <Plus size={14} className="mx-auto mb-1"/>
                          Espaco visual {laneIndex + 1}
                        </button>
                      ))}
                      </div>
                    </div>
                    {nonBlocking.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {nonBlocking.map((appt) => {
                          const completed = ['concluido', 'completed', 'finalizado'].includes(normalizeServiceType(appt.status))
                          return (
                            <div
                              key={appt.id}
                              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${completed ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-200" : "border-red-500/15 bg-red-500/5 text-muted"}`}
                            >
                              <button
                                type="button"
                                onClick={() => onEdit(appt)}
                                className={`min-w-0 flex-1 text-left ${completed ? "" : "line-through"}`}
                              >
                                {fmtAppointmentInterval(appt)} · {appt.pets?.pet_name || 'Pet'} · {statusBadge(appt.status).label}
                              </button>
                              <button
                                type="button"
                                aria-label="Imprimir ficha do historico"
                                title="Imprimir ficha 80 mm"
                                onClick={() => onReceipt(appt)}
                                className="shrink-0 rounded p-1 text-emerald-300 hover:bg-emerald-500/15"
                              >
                                <Receipt size={11}/>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AgendaPage({ setPage, agendaPeriod: controlledAgendaPeriod, onAgendaPeriodChange }) {
  const { appointments, loading, load, create, update, updateStatus, remove, serviceLabel: legacyServiceLabel, statusBadge } =
    useAppointments()
  const { clients: pets, load: loadPets, search: searchPets } = useClients()
  const { loadPetshopServices } = usePetshopAdvanced()
  const { loadSubscriptions } = useCatalogPlans()
  const { storeSettings } = useAuthCtx()

  const [selectedDate, setSelectedDate] = useState(new Date())
  const [modal, setModal]           = useState(null)   // null | {} | {appt}
  const [receipt, setReceipt]       = useState(null) // appt to print
  const view = 'agenda'
  const [localAgendaPeriod, setLocalAgendaPeriod] = useState('day') // 'day' | 'week'
  const agendaPeriod = controlledAgendaPeriod ?? localAgendaPeriod
  const setAgendaPeriod = (period) => {
    setLocalAgendaPeriod(period)
    onAgendaPeriodChange?.(period)
  }
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch]         = useState('')
  const [activeAgendaTab, setActiveAgendaTab] = useState('banho_tosa')
  const [agendaServices, setAgendaServices] = useState(SERVICES)
  const [subscriptions, setSubscriptions] = useState([])
  const staff = useMemo(() => normalizeOperationalStaff(storeSettings?.petshop_operational_staff), [storeSettings?.petshop_operational_staff])
  const deliveryStaff = useMemo(() => normalizeDeliveryStaff(storeSettings?.petshop_delivery_staff || storeSettings?.message_templates?.[PETSHOP_DELIVERY_STAFF_TEMPLATE_KEY]), [storeSettings?.petshop_delivery_staff, storeSettings?.message_templates])

  const staffById = useMemo(() => new Map((staff || []).map((person) => [person.key, person])), [staff])
  const transportOptions = useMemo(() => normalizeTransportOptions(storeSettings), [storeSettings])
  const needsPayment = (appointment) => appointmentNeedsPayment(appointment, transportOptions)
  const handleCompletedAction = (appointment) => {
    if (!appointment) return
    const totals = appointmentCheckoutTotals(appointment, transportOptions)
    if (totals.total <= 0.005) {
      setReceipt(appointment)
      return
    }
    queueAppointmentCheckout(appointment)
    setPage?.('ordens')
  }
  const serviceLabel = (value) => {
    if (value && typeof value === 'object') return appointmentServiceLabel(value, agendaServices)
    return serviceLabelFallback(value, agendaServices) || legacyServiceLabel(value)
  }
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])
  const agendaDays = useMemo(() => agendaPeriod === 'day' ? [selectedDate] : weekDays, [agendaPeriod, selectedDate, weekDays])
  const agendaStart = agendaPeriod === 'day' ? selectedDate : weekStart
  const agendaEnd = agendaPeriod === 'day' ? selectedDate : weekEnd

  useEffect(() => {
    loadPets()
    loadPetshopServices().then((items) => setAgendaServices(asAgendaServices(items))).catch((err) => console.warn('Falha ao carregar servicos:', err))
    loadSubscriptions().then((items) => setSubscriptions(items || [])).catch((err) => console.warn('Falha ao carregar assinaturas:', err))
  }, [loadPets, loadPetshopServices, loadSubscriptions])

  useEffect(() => {
    if (view === 'agenda') {
      load({
        startDate: isoDate(agendaStart),
        endDate: isoDate(agendaEnd),
        status: filterStatus || undefined,
      })
      return
    }

    load({ date: isoDate(selectedDate), status: filterStatus || undefined })
  }, [selectedDate, filterStatus, view, agendaPeriod, weekStart, weekEnd, load])

  const tabbedAppointments = appointments.filter((appointment) =>
    getAppointmentServiceGroup(appointment, agendaServices) === activeAgendaTab
  )
  const stats = buildStatsForDate(tabbedAppointments, selectedDate)
  const tabCounts = AGENDA_TABS.reduce((acc, tab) => ({
    ...acc,
    [tab.id]: appointments.filter((appointment) => getAppointmentServiceGroup(appointment, agendaServices) === tab.id).length,
  }), {})

  const displayed = tabbedAppointments.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.pets?.pet_name?.toLowerCase().includes(q) ||
      a.pets?.owner_name?.toLowerCase().includes(q) ||
      serviceLabel(a).toLowerCase().includes(q) ||
      (staffById.get(a.responsible_staff_key)?.name || a.responsible_staff_name || '').toLowerCase().includes(q)
    )
  })

  const isToday = isoDate(selectedDate) === todayISO()
  const reloadCurrentView = () => {
    if (view === 'agenda') {
      load({ startDate: isoDate(agendaStart), endDate: isoDate(agendaEnd), status: filterStatus || undefined })
      return
    }
    load({ date: isoDate(selectedDate), status: filterStatus || undefined })
  }
  const openSlotModal = (day, timeOrHour) => {
    const time = typeof timeOrHour === 'number'
      ? `${String(timeOrHour).padStart(2, '0')}:00`
      : String(timeOrHour || '08:00')
    setModal({
      serviceGroup: activeAgendaTab,
      date: isoDate(day),
      time,
    })
  }
  const handleStatusChange = async (appointmentId, status) => {
    const updated = await updateStatus(appointmentId, status)
    if (status === 'concluido' && updated) handleCompletedAction(updated)
    return updated
  }

  return (
    <div className="page animate-fade-up yuisync-agenda-page">
      {/* Header */}
      <div className="page-header yuisync-agenda-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Calendar size={22} className="text-amber-400"/> Agenda
          </h1>
          <p className="page-sub">
            {selectedDate.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
            {isToday && <span className="ml-2 badge badge-amber text-[10px]">Hoje</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 yuisync-agenda-header-actions">
          <button type="button" onClick={() => setPage?.('pets')} className="btn btn-secondary"><PawPrint size={15}/> Clientes & Pets</button>
          <button onClick={() => setModal({ serviceGroup: activeAgendaTab })} className="btn btn-primary">
            <Plus size={16}/> Novo Agendamento
          </button>
        </div>
      </div>

      {/* Stats do dia */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 yuisync-agenda-stats">
        {[
          { label: 'Total',        value: stats.total,        cls: 'text-text'       },
          { label: 'Agendados',    value: stats.agendado,     cls: 'text-[var(--ui-warning-fg)]' },
          { label: 'Confirmados',  value: stats.confirmado,   cls: 'text-[var(--ui-info-fg)]' },
          { label: 'Em andamento', value: stats.em_andamento, cls: 'text-[var(--ui-progress-fg)]' },
          { label: 'Concluídos',   value: stats.concluido,    cls: 'text-[var(--ui-success-fg)]' },
          { label: 'Cancelados',   value: stats.cancelado,    cls: 'text-[var(--ui-danger-fg)]' },
        ].map(s => (
          <Card key={s.label} className="p-3 text-center yuisync-agenda-stat">
            <p className={`font-display font-bold text-2xl ${s.cls}`}>{s.value}</p>
            <p className="text-xs text-muted mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      <Card className="flex w-fit max-w-full flex-wrap gap-2 p-1 yuisync-agenda-tabs">
        {AGENDA_TABS.map(tab => {
          const Icon = tab.icon
          const active = activeAgendaTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveAgendaTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
                active ? 'bg-[var(--primary)] text-[var(--primary-contrast)]' : 'text-muted hover:text-text hover:bg-white/5'
              }`}
            >
              <Icon size={14}/>
              {tab.label}
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-gray-950/15' : 'bg-white/8 text-muted'}`}>
                {tabCounts[tab.id] || 0}
              </span>
            </button>
          )
        })}
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 yuisync-agenda-controls">
        {/* Date Navigator */}
        <Card className="flex items-center gap-1 p-1 yuisync-agenda-date-nav">
          <button aria-label="Dia anterior" title="Dia anterior" onClick={() => setSelectedDate(d => addDays(d,-1))}
            className="btn btn-ghost btn-sm btn-icon">
            <ChevronLeft size={15}/>
          </button>
          <button onClick={() => setSelectedDate(new Date())}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              isToday ? 'text-[var(--primary)] bg-[var(--primary-bg-light)]' : 'text-muted hover:text-text'
            }`}>
            {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </button>
          <button aria-label="Próximo dia" title="Próximo dia" onClick={() => setSelectedDate(d => addDays(d,1))}
            className="btn btn-ghost btn-sm btn-icon">
            <ChevronRight size={15}/>
          </button>
        </Card>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] yuisync-agenda-search">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"/>
          <input aria-label="Buscar pet ou tutor" className="inp pl-9 py-2" placeholder="Buscar pet, tutor..."
            value={search} onChange={e => setSearch(e.target.value)}/>
        </div>

        {/* Status filter */}
        <select aria-label="Filtrar por status" className="inp py-2 w-auto yuisync-agenda-status-filter" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {view === 'agenda' && (
          <Card className="flex p-1 yuisync-agenda-period-toggle">
            {[
              { id: 'day', label: 'Diaria' },
              { id: 'week', label: 'Semanal' },
            ].map((period) => (
              <button
                key={period.id}
                type="button"
                onClick={() => setAgendaPeriod(period.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  agendaPeriod === period.id ? 'bg-[var(--primary)] text-[var(--primary-contrast)]' : 'text-muted hover:text-text'
                }`}
              >
                {period.label}
              </button>
            ))}
          </Card>
        )}

        <button onClick={reloadCurrentView}
          className="btn btn-ghost btn-sm btn-icon yuisync-agenda-refresh" title="Atualizar">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
        </button>
      </div>

      {/* Content */}
      <div
        key={`${view}-${agendaPeriod}-${isoDate(selectedDate)}-${activeAgendaTab}`}
        className="yuisync-agenda-view-transition"
      >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted text-sm">
          <RefreshCw size={16} className="animate-spin mr-2"/> Carregando...
        </div>
      ) : displayed.length === 0 && view !== 'agenda' ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 bg-card border border-[var(--border)] rounded-xl2">
          <Calendar size={40} className="text-muted/30"/>
          <div className="text-center">
            <p className="text-text font-semibold">Nenhum agendamento</p>
            <p className="text-muted text-sm mt-1">
              {filterStatus || search ? 'Tente remover os filtros' : 'Clique em "+ Novo Agendamento" para começar'}
            </p>
          </div>
          <button onClick={() => setModal({ serviceGroup: activeAgendaTab })} className="btn btn-primary">
            <Plus size={15}/> Novo Agendamento
          </button>
        </div>
      ) : view === 'agenda' ? (
        <AgendaTimelineView
          days={agendaDays}
          selectedDate={selectedDate}
          appointments={displayed}
          serviceLabel={serviceLabel}
          statusBadge={statusBadge}
          staffById={staffById}
          onEdit={(appt) => setModal(appt)}
          onReceipt={setReceipt}
          onCompletedAction={handleCompletedAction}
          needsPayment={needsPayment}
          slotCapacity={MANUAL_SLOT_CAPACITY}
          onCreateAt={openSlotModal}
          onSelectDate={setSelectedDate}
        />
      ) : view === 'list' ? (
        /* ── LIST VIEW ── */
        <div className="bg-card border border-[var(--border)] rounded-xl2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th>Hora</th><th>Pet</th><th>Tutor e endereço</th><th>Serviço</th>
                <th>Responsavel</th><th>Status</th><th>Valor</th><th>Obs.</th><th></th>
              </tr></thead>
              <tbody>
                {displayed.map(a => {
                  const sb = statusBadge(a.status)
                  return (
                    <tr key={a.id}>
                      <td><span className="font-bold text-amber-400 font-display whitespace-nowrap">{fmtInterval(a)}</span></td>
                      <td>
                        <p className="text-base font-black text-text">{a.pets?.pet_name || '—'}</p>
                        <p className="text-xs text-muted">{a.pets?.breed || a.pets?.species}</p>
                      </td>
                      <td>
                        <p className="text-sm font-bold text-text">{a.pets?.owner_name || '—'}</p>
                        <p className="text-xs text-muted">{[a.pets?.owner_address, a.pets?.owner_neighborhood, a.pets?.owner_city].filter(Boolean).join(' - ') || a.motodog?.address || 'Endereço não informado'}</p>
                        <p className="text-xs text-muted">{a.pets?.phone}</p>
                      </td>
                      <td className="text-xs">
                        <span>{serviceLabel(a)}</span>
                        <MotodogAgendaInfo appt={a} compact/>
                      </td>
                      <td className="text-xs">
                        {staffById.get(a.responsible_staff_key)?.name || a.responsible_staff_name || (
                          <span className={a.status === 'concluido' ? 'text-amber-400 font-semibold' : 'text-muted'}>Sem responsavel</span>
                        )}
                      </td>
                      <td><span className={`badge ${sb.cls}`}>{sb.label}</span></td>
                      <td><span className="font-semibold text-emerald-400">{fmtCurrency(a.price)}</span></td>
                      <td><span className="text-xs text-muted truncate max-w-[120px] block">{a.notes || '—'}</span></td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label="Editar agendamento" title="Editar" onClick={() => setModal(a)} className="btn btn-ghost btn-sm btn-icon">
                            <Edit2 size={13}/>
                          </button>
                          {a.status === 'concluido' && (
                            <button type="button" aria-label={needsPayment(a) ? 'Receber atendimento' : 'Imprimir ficha'} onClick={() => handleCompletedAction(a)}
                              className={`btn btn-ghost btn-sm btn-icon border ${needsPayment(a) ? 'text-amber-400 border-amber-500/20' : 'text-emerald-400 border-emerald-500/20'}`} title={needsPayment(a) ? 'Receber e lancar no caixa' : 'Imprimir ficha'}>
                              {needsPayment(a) ? <Wallet size={13}/> : <Receipt size={13}/>}
                            </button>
                          )}
                          {['agendado','confirmado'].includes(a.status) && (
                            <button type="button" aria-label="Concluir agendamento" onClick={() => handleStatusChange(a.id, 'concluido')}
                              className="btn btn-success btn-sm btn-icon" title="Concluir">
                              <Check size={13}/>
                            </button>
                          )}
                          <button type="button" aria-label="Excluir agendamento" onClick={() => remove(a.id)}
                            className="btn btn-danger btn-sm btn-icon" title="Excluir">
                            <Trash2 size={13}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── KANBAN VIEW ── */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { status:'agendado',     label:'Agendado',       cls:'text-amber-400',   icon: ClipboardList },
            { status:'confirmado',   label:'Confirmado',     cls:'text-amber-400',    icon: CheckCircle },
            { status:'em_andamento', label:'Em andamento',   cls:'text-violet-400',  icon: Zap },
            { status:'concluido',    label:'Concluído',      cls:'text-emerald-400', icon: CheckCircle },
            { status:'cancelado',    label:'Cancelado',      cls:'text-red-400',     icon: XCircle },
          ].map(col => {
            const colItems = displayed.filter(a => a.status === col.status)
            return (
              <div key={col.status} className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className={`flex items-center gap-1.5 text-xs font-bold ${col.cls}`}>
                    <col.icon size={13}/> {col.label}
                  </div>
                  <span className="text-xs text-muted bg-white/8 rounded-full px-2 py-0.5">{colItems.length}</span>
                </div>
                <div className="space-y-2.5 min-h-[100px]">
                  {colItems.map(a => (
                    <KanbanCard key={a.id} appt={a} serviceLabel={serviceLabel} statusBadge={statusBadge}
                      onEdit={(a) => setModal(a)} onStatus={handleStatusChange} onReceipt={setReceipt}
                      onCompletedAction={handleCompletedAction} needsPayment={needsPayment}
                      services={agendaServices} staffById={staffById}/>
                  ))}
                  {colItems.length === 0 && (
                    <div className="border border-dashed border-[var(--border)] rounded-xl p-4 text-center">
                      <p className="text-xs text-muted/40">Vazio</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>

      {/* Modals */}
      {modal !== null && (
        <ApptModal
          appt={modal?.id ? modal : modal}
          pets={pets}
          services={agendaServices}
          subscriptions={subscriptions}
          staff={staff}
          deliveryStaff={deliveryStaff}
          transportOptions={transportOptions}
          serviceDurations={storeSettings?.petshop_service_durations}
          onSearchClients={searchPets}
          appointments={appointments}
          slotCapacity={MANUAL_SLOT_CAPACITY}
          onClose={() => setModal(null)}
          onCreate={create}
          onUpdate={update}
          onRefreshSubscriptions={() => loadSubscriptions().then((items) => setSubscriptions(items || []))}
          onManagePets={() => { setModal(null); setPage?.('pets') }}
          onReceipt={setReceipt}
        />
      )}

      {receipt !== null && (
        <ReceiptModal 
          appt={receipt} 
          onClose={() => setReceipt(null)}
          serviceLabel={serviceLabel}
          staffById={staffById}
        />
      )}
    </div>
  )
}
