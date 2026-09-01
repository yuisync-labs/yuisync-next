import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Bike,
  CheckCircle,
  Download,
  Eye,
  Percent,
  Pencil,
  Printer,
  Save,
  RefreshCw,
  RotateCcw,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import { fmtCurrency } from '../../../lib/supabase'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import {
  normalizeOperationalStaff,
  PETSHOP_COMMISSION_RESET_TEMPLATE_KEY,
} from '../../../../shared/petshopOperations'
import {
  appointmentCommissionLines,
  appointmentHasCommissionServices,
  buildCommissionRows,
  commissionHistoryLabel,
  hydrateLegacyCommissionAppointments,
} from '../lib/teamCommissionSummary'
import {
  assignAppointmentDeliveryStaff,
  assignSaleDeliveryStaff,
  deliveryStaffFromSettings,
  loadDeliveryTeamSnapshot,
} from '../lib/deliveryOperations'
import { persistPetshopTeamSettings } from '../lib/teamSettingsOperations'
import { enrichPackageCommissionAppointments } from '../lib/packageCommissionOperations'
import {
  petshopDateLabel,
  petshopDateTimeLabel,
  petshopMonthRange,
} from '../lib/petshopDateTime'

const TABS = [
  { id: 'fechamento', label: 'Comissoes', icon: Wallet },
  { id: 'esteticistas', label: 'Esteticistas', icon: Users },
  { id: 'motoboy', label: 'Motoboy', icon: Bike },
]

const emptyRange = () => petshopMonthRange()
const dateLabel = petshopDateLabel
const dateTimeLabel = petshopDateTimeLabel
const escapeHtml = (value = '') => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

function openPrintDocument(title, body) {
  const printWindow = window.open('', '_blank', 'width=1080,height=780')
  if (!printWindow) return
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111; margin: 0; font-size: 10px; }
    h1 { font-size: 18px; margin: 0 0 5px; }
    .meta { margin-bottom: 12px; color: #444; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #aaa; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #eee; font-size: 9px; text-transform: uppercase; }
    .money { text-align: right; white-space: nowrap; }
    .total { font-weight: 800; }
  </style></head><body>${body}</body></html>`)
  printWindow.document.close()
  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 180)
}

function CommissionHistoryModal({ row, items, range, onClose }) {
  const responsibleName = row?.collaborator_name || row?.staff_key || 'Responsavel'
  const lineRows = items.flatMap((appointment) => appointmentCommissionLines(appointment).map((line, index) => ({
    id: `${appointment.id}:${index}`,
    appointment,
    line,
  })))
  const revenue = lineRows.reduce((sum, item) => sum + Number(item.line.revenue || 0), 0)
  const commission = lineRows.reduce((sum, item) => sum + Number(item.line.commission || 0), 0)

  function printHistory() {
    const rows = lineRows.map(({ appointment, line }) => `<tr>
      <td>${escapeHtml(dateLabel(appointment.scheduled_at))}</td>
      <td>${escapeHtml(appointment.client?.owner_name || '-')}</td>
      <td>${escapeHtml(appointment.client?.pet_name || '-')}</td>
      <td>${escapeHtml(line.label)}</td>
      <td class="money">${escapeHtml(fmtCurrency(line.revenue))}</td>
      <td class="money">${escapeHtml(fmtCurrency(line.commission))}</td>
    </tr>`).join('')
    openPrintDocument(`Conferencia - ${responsibleName}`, `
      <h1>Historico de servicos - ${escapeHtml(responsibleName)}</h1>
      <div class="meta">Periodo: ${escapeHtml(dateLabel(range.startDate))} a ${escapeHtml(dateLabel(range.endDate))}</div>
      <table><thead><tr><th>Data</th><th>Tutor</th><th>Pet</th><th>Servico</th><th>Valor</th><th>Comissao</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">Nenhum atendimento no periodo.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="4">Totais</td><td class="money">${escapeHtml(fmtCurrency(revenue))}</td><td class="money">${escapeHtml(fmtCurrency(commission))}</td></tr></tfoot></table>
    `)
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-5xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Historico de {responsibleName}</h2>
            <p className="mt-1 text-sm text-muted">{dateLabel(range.startDate)} a {dateLabel(range.endDate)} · {lineRows.length} servico(s)</p>
          </div>
          <button type="button" aria-label="Fechar historico" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-4">
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="tbl min-w-[820px]">
              <thead><tr><th>Data</th><th>Tutor</th><th>Pet</th><th>Servico</th><th>Valor</th><th>Comissao</th></tr></thead>
              <tbody>
                {lineRows.map(({ id, appointment, line }) => (
                  <tr key={id}>
                    <td>{dateLabel(appointment.scheduled_at)}</td>
                    <td>{appointment.client?.owner_name || '-'}</td>
                    <td className="font-semibold text-text">{appointment.client?.pet_name || '-'}</td>
                    <td>{line.label}</td>
                    <td>{fmtCurrency(line.revenue)}</td>
                    <td className="font-semibold text-emerald-400">{fmtCurrency(line.commission)}</td>
                  </tr>
                ))}
                {!lineRows.length && <tr><td colSpan={6} className="py-10 text-center text-muted">Nenhum servico comissionavel no periodo.</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={4} className="font-bold text-text">Total conferido</td><td className="font-bold">{fmtCurrency(revenue)}</td><td className="font-bold text-emerald-400">{fmtCurrency(commission)}</td></tr></tfoot>
            </table>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="btn btn-secondary">Fechar</button>
            <button type="button" onClick={printHistory} className="btn btn-primary"><Printer size={15}/> Imprimir historico</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function EquipePage() {
  const {
    loadTeamSnapshot,
    loadPetshopServices,
    assignPendingServiceResponsible,
  } = usePetshopAdvanced()
  const auth = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const { storeSettings, activeTenantId } = auth

  const [activeTab, setActiveTab] = useState('fechamento')
  const [pendingServices, setPendingServices] = useState([])
  const [serviceHistory, setServiceHistory] = useState([])
  const [historyRow, setHistoryRow] = useState(null)
  const [services, setServices] = useState([])
  const [deliveryRows, setDeliveryRows] = useState([])
  const [range, setRange] = useState(emptyRange)
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')
  const [assigningServiceId, setAssigningServiceId] = useState('')
  const [assigningDeliveryId, setAssigningDeliveryId] = useState('')
  const [editingStaffKey, setEditingStaffKey] = useState('')
  const [editingStaffName, setEditingStaffName] = useState('')
  const [savingStaffKey, setSavingStaffKey] = useState('')
  const [resettingCommissions, setResettingCommissions] = useState(false)

  const configuredStaff = useMemo(
    () => normalizeOperationalStaff(storeSettings?.petshop_operational_staff),
    [storeSettings?.petshop_operational_staff],
  )
  const configuredDeliveryStaff = useMemo(
    () => deliveryStaffFromSettings(storeSettings),
    [storeSettings],
  )
  const configuredStaffByKey = useMemo(
    () => new Map(configuredStaff.map((person) => [person.key, person])),
    [configuredStaff],
  )
  const assignableStaff = useMemo(
    () => configuredStaff.filter((person) => person.active !== false),
    [configuredStaff],
  )
  const assignableDeliveryStaff = useMemo(
    () => configuredDeliveryStaff.filter((person) => person.active !== false),
    [configuredDeliveryStaff],
  )
  const commissionResetAt = storeSettings?.message_templates?.[PETSHOP_COMMISSION_RESET_TEMPLATE_KEY] || null
  const hydratedServiceHistory = useMemo(
    () => hydrateLegacyCommissionAppointments(serviceHistory, services),
    [serviceHistory, services],
  )
  const hydratedPendingServices = useMemo(
    () => hydrateLegacyCommissionAppointments(pendingServices, services),
    [pendingServices, services],
  )
  const afterCommissionReset = (appointment) => {
    if (!commissionResetAt) return true
    const resetTime = new Date(commissionResetAt).getTime()
    const appointmentTime = new Date(appointment?.scheduled_at || 0).getTime()
    return !Number.isFinite(resetTime) || appointmentTime > resetTime
  }
  const commissionServiceHistory = useMemo(
    () => hydratedServiceHistory.filter(afterCommissionReset),
    [hydratedServiceHistory, commissionResetAt],
  )
  const displayRows = useMemo(
    () => buildCommissionRows(commissionServiceHistory, configuredStaff),
    [configuredStaff, commissionServiceHistory],
  )
  const commissionPendingServices = useMemo(
    () => hydratedPendingServices.filter(afterCommissionReset).filter(appointmentHasCommissionServices),
    [hydratedPendingServices, commissionResetAt],
  )

  async function reload(nextRange = range) {
    setLoading(true)
    setError('')
    try {
      const [snapshot, serviceRows, deliveries] = await Promise.all([
        loadTeamSnapshot(nextRange),
        loadPetshopServices(),
        loadDeliveryTeamSnapshot({
          moduleId: activeModuleId || 'petshop',
          tenantId: activeTenantId,
          startDate: nextRange.startDate,
          endDate: nextRange.endDate,
          settings: storeSettings,
        }),
      ])
      const pendingCount = (snapshot.pendingServices || []).length
      const enrichedAppointments = await enrichPackageCommissionAppointments({
        appointments: [...(snapshot.pendingServices || []), ...(snapshot.serviceHistory || [])],
        moduleId: activeModuleId || 'petshop',
        tenantId: activeTenantId,
        settings: storeSettings,
        catalogServices: serviceRows || [],
      })
      setPendingServices(enrichedAppointments.slice(0, pendingCount))
      setServiceHistory(enrichedAppointments.slice(pendingCount))
      setServices(serviceRows || [])
      setDeliveryRows(deliveries || [])
    } catch (err) {
      setError(err.message || 'Nao foi possivel carregar a equipe.')
    } finally {
      setLoading(false)
      setHasLoaded(true)
    }
  }

  async function assignPendingResponsible(appointment, staffKey) {
    if (!appointment?.id || !staffKey || appointment.responsible_staff_key) return
    const person = configuredStaffByKey.get(staffKey)
    if (!person) return
    setAssigningServiceId(appointment.id)
    setError('')
    try {
      await assignPendingServiceResponsible(appointment.id, {
        key: person.key,
        name: person.name,
        service_items: appointment.service_items,
      })
      await reload(range)
    } catch (err) {
      setError(err.message)
    } finally {
      setAssigningServiceId('')
    }
  }

  async function assignDelivery(row, staffKey) {
    const person = configuredDeliveryStaff.find((item) => item.key === staffKey)
    if (!row || !person) return
    setAssigningDeliveryId(row.id)
    setError('')
    try {
      if (row.record_type === 'appointment') {
        await assignAppointmentDeliveryStaff({
          moduleId: activeModuleId || 'petshop',
          tenantId: activeTenantId,
          appointmentId: row.appointment_id,
          staff: person,
        })
      } else {
        await assignSaleDeliveryStaff({
          moduleId: activeModuleId || 'petshop',
          tenantId: activeTenantId,
          saleId: row.sale_id,
          staff: person,
          deliveryValue: row.delivery_value,
        })
      }
      await reload(range)
    } catch (err) {
      setError(err.message)
    } finally {
      setAssigningDeliveryId('')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const selectedHistoryItems = useMemo(() => historyRow?.staff_key
    ? commissionServiceHistory.filter((item) => (
      item.responsible_staff_key === historyRow.staff_key
      && appointmentHasCommissionServices(item)
    ))
    : [], [historyRow, commissionServiceHistory])

  const totals = useMemo(() => displayRows.reduce((acc, row) => ({
    serviceCount: acc.serviceCount + Number(row.service_count || 0),
    packageCount: acc.packageCount + Number(row.package_count || 0),
    packageRevenue: acc.packageRevenue + Number(row.package_revenue || 0),
    serviceRevenue: acc.serviceRevenue + Number(row.service_revenue || 0),
    commission: acc.commission + Number(row.total_commission || 0),
  }), { serviceCount: 0, packageCount: 0, packageRevenue: 0, serviceRevenue: 0, commission: 0 }), [displayRows])
  const initialLoading = loading && !hasLoaded

  const deliverySummary = useMemo(() => {
    const map = new Map(configuredDeliveryStaff.map((person) => [person.key, {
      staff_key: person.key,
      staff_name: person.name,
      active: person.active !== false,
      count: 0,
      total: 0,
    }]))
    deliveryRows.forEach((row) => {
      const key = row.staff_key || 'sem-responsavel'
      if (!map.has(key)) {
        map.set(key, {
          staff_key: key,
          staff_name: row.staff_name || 'Sem motoboy',
          active: true,
          count: 0,
          total: 0,
        })
      }
      const item = map.get(key)
      item.count += 1
      item.total += Number(row.delivery_value || 0)
    })
    return [...map.values()]
  }, [configuredDeliveryStaff, deliveryRows])

  function resetRangeToMonth() {
    const next = emptyRange()
    setRange(next)
    void reload(next)
  }

  async function saveStaffName(person) {
    const cleanName = editingStaffName.trim()
    if (!cleanName || !person?.key) return
    const moduleId = activeModuleId || 'petshop'
    const nextStaff = normalizeOperationalStaff(configuredStaff.map((item) => (
      item.key === person.key ? { ...item, name: cleanName } : item
    )))
    const previousSettings = storeSettings
    const optimisticTemplates = {
      ...(storeSettings?.message_templates || {}),
      __petshop_operational_staff: nextStaff,
    }
    setSavingStaffKey(person.key)
    setError('')
    auth.updateStoreSettings?.({
      petshop_operational_staff: nextStaff,
      message_templates: optimisticTemplates,
    })
    try {
      const saved = await persistPetshopTeamSettings({
        moduleId,
        tenantId: activeTenantId,
        currentSettings: { ...storeSettings, message_templates: optimisticTemplates },
        staff: nextStaff,
      })
      auth.updateStoreSettings?.(saved)
      setEditingStaffKey('')
      setEditingStaffName('')
      await auth.refreshSettings(moduleId)
    } catch (err) {
      auth.updateStoreSettings?.(previousSettings)
      setError(err.message || 'Nao foi possivel alterar o nome da esteticista.')
    } finally {
      setSavingStaffKey('')
    }
  }

  async function resetCommissionCycle() {
    if (!window.confirm('Zerar o fechamento atual? Os agendamentos nao serao apagados; eles apenas ficarao fora do proximo ciclo de comissoes.')) return
    const moduleId = activeModuleId || 'petshop'
    const resetAt = new Date().toISOString()
    const previousSettings = storeSettings
    const optimisticTemplates = {
      ...(storeSettings?.message_templates || {}),
      [PETSHOP_COMMISSION_RESET_TEMPLATE_KEY]: resetAt,
    }
    setResettingCommissions(true)
    setError('')
    setHistoryRow(null)
    auth.updateStoreSettings?.({ message_templates: optimisticTemplates })
    try {
      const saved = await persistPetshopTeamSettings({
        moduleId,
        tenantId: activeTenantId,
        currentSettings: { ...storeSettings, message_templates: optimisticTemplates },
        staff: configuredStaff,
        templatePatch: { [PETSHOP_COMMISSION_RESET_TEMPLATE_KEY]: resetAt },
      })
      auth.updateStoreSettings?.(saved)
      await auth.refreshSettings(moduleId)
    } catch (err) {
      auth.updateStoreSettings?.(previousSettings)
      setError(err.message || 'Nao foi possivel zerar o fechamento de comissoes.')
    } finally {
      setResettingCommissions(false)
    }
  }

  function renderEditableStaffName(person, compact = false) {
    if (editingStaffKey === person.key) {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className={`inp ${compact ? 'min-w-[150px] py-1 text-sm' : 'min-w-[190px]'}`}
            value={editingStaffName}
            autoFocus
            onChange={(event) => setEditingStaffName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveStaffName(person)
              if (event.key === 'Escape') setEditingStaffKey('')
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={savingStaffKey === person.key} onClick={() => void saveStaffName(person)}>
            <Save size={13}/> {savingStaffKey === person.key ? 'Salvando...' : 'Salvar'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingStaffKey('')}>Cancelar</button>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2">
        <span className={compact ? 'font-semibold text-text' : 'font-display text-lg font-bold text-text'}>{person.name}</span>
        <button
          type="button"
          title="Editar nome da esteticista"
          aria-label={`Editar nome de ${person.name}`}
          className="rounded-lg p-1.5 text-muted hover:text-emerald-400 hover:bg-emerald-500/10"
          onClick={() => { setEditingStaffKey(person.key); setEditingStaffName(person.name) }}
        >
          <Pencil size={13}/>
        </button>
      </div>
    )
  }

  function printCommissionSummary() {
    const bodyRows = displayRows.map((row) => `<tr>
      <td>${escapeHtml(row.collaborator_name)}</td>
      <td>${row.bath_count}</td>
      <td>${row.machine_grooming_count}</td>
      <td>${row.scissor_grooming_count}</td>
      <td>${row.package_count}</td>
      <td>${row.other_service_count}</td>
      <td class="money">${escapeHtml(fmtCurrency(row.service_revenue))}</td>
      <td class="money">${escapeHtml(fmtCurrency(row.total_commission))}</td>
    </tr>`).join('')
    openPrintDocument('Resumo geral de comissoes', `
      <h1>Resumo geral de comissoes</h1>
      <div class="meta">Periodo: ${escapeHtml(dateLabel(range.startDate))} a ${escapeHtml(dateLabel(range.endDate))}</div>
      <table><thead><tr><th>Esteticista</th><th>Banhos</th><th>Tosa maquina/total</th><th>Tosa tesoura</th><th>Pacote</th><th>Outros</th><th>Receita</th><th>Total a pagar</th></tr></thead>
      <tbody>${bodyRows || '<tr><td colspan="8">Sem producao no periodo.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="6">Totais do periodo</td><td class="money">${escapeHtml(fmtCurrency(totals.serviceRevenue))}</td><td class="money">${escapeHtml(fmtCurrency(totals.commission))}</td></tr></tfoot></table>
    `)
  }

  function printDeliverySummary() {
    const total = deliveryRows.reduce((sum, row) => sum + Number(row.delivery_value || 0), 0)
    const bodyRows = deliveryRows.map((row) => `<tr>
      <td>${escapeHtml(dateLabel(row.occurred_at))}</td>
      <td>${escapeHtml(row.staff_name || 'Sem motoboy')}</td>
      <td>${escapeHtml(row.client_name)}</td>
      <td>${escapeHtml(row.pet_name || '-')}</td>
      <td>${escapeHtml(row.source_label)}</td>
      <td class="money">${escapeHtml(fmtCurrency(row.delivery_value))}</td>
    </tr>`).join('')
    openPrintDocument('Resumo de entregas', `
      <h1>Resumo de entregas e MotoDog</h1>
      <div class="meta">Periodo: ${escapeHtml(dateLabel(range.startDate))} a ${escapeHtml(dateLabel(range.endDate))}</div>
      <table><thead><tr><th>Data</th><th>Motoboy</th><th>Cliente</th><th>Pet</th><th>Origem</th><th>Valor integral</th></tr></thead>
      <tbody>${bodyRows || '<tr><td colspan="6">Sem entregas concluidas no periodo.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="5">Total das entregas</td><td class="money">${escapeHtml(fmtCurrency(total))}</td></tr></tfoot></table>
    `)
  }

  function exportCsv() {
    const lines = [
      ['Esteticista', 'Banhos', 'Tosa maquina/total', 'Tosa tesoura', 'Pacote', 'Outros', 'Receita', 'Comissao'].join(','),
      ...displayRows.map((row) => [
        `"${String(row.collaborator_name || '').replace(/"/g, '""')}"`,
        row.bath_count,
        row.machine_grooming_count,
        row.scissor_grooming_count,
        row.package_count,
        row.other_service_count,
        Number(row.service_revenue || 0).toFixed(2),
        Number(row.total_commission || 0).toFixed(2),
      ].join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `comissoes-${range.startDate}-${range.endDate}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page animate-fade-up space-y-6" aria-busy={loading}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Percent size={22} className="text-emerald-400" />
            Equipe & Comissoes
          </h1>
          <p className="page-sub">Estetica e entregas operacionais sem criar usuarios ou logins.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => reload()} className="btn btn-secondary">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          {activeTab === 'fechamento' && <button onClick={exportCsv} className="btn btn-secondary"><Download size={15}/> Exportar CSV</button>}
          {activeTab === 'fechamento' && <button onClick={printCommissionSummary} className="btn btn-primary"><Printer size={15}/> Imprimir resumo geral</button>}
          {activeTab === 'motoboy' && <button onClick={printDeliverySummary} className="btn btn-primary"><Printer size={15}/> Imprimir total</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-card border border-[var(--border)] rounded-xl p-1 w-fit max-w-full">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
                active ? 'bg-emerald-500 text-gray-950' : 'text-muted hover:text-text hover:bg-white/5'
              }`}
            >
              <Icon size={14} /> {tab.label}
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm rounded-xl px-4 py-3 bg-red-500/10 text-red-400 border border-red-500/20">{error}</p>}

      {(activeTab === 'fechamento' || activeTab === 'motoboy') && (
        <div className="flex items-end gap-3 flex-wrap">
          <div><label className="inp-label">Inicio</label><input className="inp" type="date" value={range.startDate} onChange={(event) => setRange((prev) => ({ ...prev, startDate: event.target.value }))}/></div>
          <div><label className="inp-label">Fim</label><input className="inp" type="date" value={range.endDate} onChange={(event) => setRange((prev) => ({ ...prev, endDate: event.target.value }))}/></div>
          <button onClick={() => reload(range)} className="btn btn-primary"><RefreshCw size={15}/> Recalcular</button>
          <button onClick={resetRangeToMonth} className="btn btn-secondary">Periodo do mes</button>
          {activeTab === 'fechamento' && (
            <button onClick={() => void resetCommissionCycle()} disabled={resettingCommissions} className="btn btn-secondary">
              <RotateCcw size={15} className={resettingCommissions ? 'animate-spin' : ''}/> {resettingCommissions ? 'Zerando...' : 'Zerar fechamento'}
            </button>
          )}
        </div>
      )}

      {activeTab === 'fechamento' && (
        <div className="space-y-5">
          {commissionResetAt && (
            <p className="text-xs text-muted">Ultimo fechamento zerado em {dateTimeLabel(commissionResetAt)}. Agendamentos anteriores continuam preservados no historico operacional.</p>
          )}
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 px-5 py-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={18} className="mt-0.5 text-emerald-400" />
              <div>
                <p className="font-semibold text-text">Somente servicos de estetica entram na comissao</p>
                <p className="mt-1 text-sm text-muted">Tosa 10%. Banho e demais servicos 5%. Pacotes usam o valor liquido por unidade; o valor integral do MotoDog e retirado antes da divisao. Transporte e entrega nao entram na comissao da esteticista.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-card border border-[var(--border)] rounded-xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Servicos concluidos</p><p className="font-display font-bold text-3xl text-text">{initialLoading ? '—' : totals.serviceCount}</p></div>
            <div className="bg-card border border-[var(--border)] rounded-xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Pacotes executados</p><p className="font-display font-bold text-3xl text-amber-400">{initialLoading ? '—' : totals.packageCount}</p><p className="mt-1 text-xs text-muted">{initialLoading ? 'Carregando dados...' : `${fmtCurrency(totals.packageRevenue)} em servicos`}</p></div>
            <div className="bg-card border border-[var(--border)] rounded-xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Receita estetica</p><p className="font-display font-bold text-3xl text-emerald-400">{initialLoading ? '—' : fmtCurrency(totals.serviceRevenue)}</p></div>
            <div className="bg-card border border-[var(--border)] rounded-xl p-5"><p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Total a pagar</p><p className="font-display font-bold text-3xl text-amber-400">{initialLoading ? '—' : fmtCurrency(totals.commission)}</p></div>
          </div>

          {commissionPendingServices.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-400 mt-0.5" />
                <div><p className="font-semibold text-text">Servicos esteticos concluidos sem responsavel</p><p className="text-sm text-muted mt-1">Escolha a esteticista para incluir estes atendimentos no fechamento.</p></div>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {commissionPendingServices.slice(0, 12).map((appt) => {
                  const commissionValue = appointmentCommissionLines(appt).reduce((sum, line) => sum + Number(line.revenue || 0), 0)
                  return (
                    <div key={appt.id} className="rounded-xl border border-[var(--border)] bg-card px-4 py-3 text-sm">
                      <p className="font-semibold text-text">{appt.client?.pet_name || appt.client?.owner_name || 'Pet'} - {commissionHistoryLabel(appt)}</p>
                      <p className="text-xs text-muted mt-1">{dateLabel(appt.scheduled_at)} • base {fmtCurrency(commissionValue)}</p>
                      <select
                        className="inp mt-3 text-xs"
                        defaultValue=""
                        disabled={assigningServiceId === appt.id || assignableStaff.length === 0}
                        onChange={(event) => event.target.value && void assignPendingResponsible(appt, event.target.value)}
                      >
                        <option value="">{assigningServiceId === appt.id ? 'Salvando...' : 'Selecionar responsavel'}</option>
                        {assignableStaff.map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="tbl-wrapper overflow-x-auto">
            <table className="tbl min-w-[1130px]">
              <thead><tr><th>Esteticista</th><th>Banhos</th><th>Tosa maquina/total</th><th>Tosa tesoura</th><th>Pacote</th><th>Outros</th><th>Receita</th><th>Total</th><th className="sticky right-0 z-10 bg-card">Conferencia</th></tr></thead>
              <tbody>
                {initialLoading && <tr><td colSpan={9} className="text-center text-muted py-10">Carregando fechamento...</td></tr>}
                {!initialLoading && displayRows.map((row) => (
                  <tr key={row.staff_key}>
                    <td>{renderEditableStaffName(configuredStaffByKey.get(row.staff_key) || { key: row.staff_key, name: row.collaborator_name, active: true }, true)}</td>
                    <td>{row.bath_count}</td>
                    <td>{row.machine_grooming_count}</td>
                    <td>{row.scissor_grooming_count}</td>
                    <td className="font-bold text-amber-400">{row.package_count}</td>
                    <td>{row.other_service_count}</td>
                    <td>{fmtCurrency(row.service_revenue)}</td>
                    <td className="text-emerald-400 font-bold">{fmtCurrency(row.total_commission)}</td>
                    <td className="sticky right-0 z-[1] !bg-card"><button type="button" title="Visualizar e imprimir historico" aria-label="Visualizar e imprimir historico" onClick={() => setHistoryRow(row)} className="btn btn-secondary btn-sm"><Eye size={13}/> Conferir</button></td>
                  </tr>
                ))}
                {!displayRows.length && !loading && <tr><td colSpan={9} className="text-center text-muted py-10">Sem producao concluida no periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historyRow && <CommissionHistoryModal row={historyRow} items={selectedHistoryItems} range={range} onClose={() => setHistoryRow(null)}/>}

      {activeTab === 'esteticistas' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-card px-5 py-4">
            <p className="font-semibold text-text">Mesmas profissionais da Agenda</p>
            <p className="mt-1 text-sm text-muted">Cadastros operacionais definidos em Configuracoes, sem login, e-mail ou usuario no YuiSync.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {configuredStaff.map((person) => {
              const row = displayRows.find((item) => item.staff_key === person.key)
              return (
                <div key={person.key} className="rounded-2xl border border-[var(--border)] bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>{renderEditableStaffName(person)}<p className="mt-1 text-xs text-muted">{row?.service_count || 0} servico(s) no periodo</p></div>
                    <span className={`badge ${person.active === false ? 'badge-gray' : 'badge-green'}`}>{person.active === false ? 'Inativa' : 'Ativa'}</span>
                  </div>
                  <div className="mt-5 grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-xl border border-[var(--border2)] p-3"><p className="text-[10px] text-muted uppercase">Banhos</p><p className="font-bold text-emerald-400">{row?.bath_count || 0}</p></div>
                    <div className="rounded-xl border border-[var(--border2)] p-3"><p className="text-[10px] text-muted uppercase">Tosas</p><p className="font-bold text-blue-400">{row?.grooming_count || 0}</p></div>
                    <div className="rounded-xl border border-[var(--border2)] p-3"><p className="text-[10px] text-muted uppercase">Pacotes</p><p className="font-bold text-amber-400">{row?.package_count || 0}</p></div>
                    <div className="rounded-xl border border-[var(--border2)] p-3"><p className="text-[10px] text-muted uppercase">Outros</p><p className="font-bold text-text">{row?.other_service_count || 0}</p></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'motoboy' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-5 py-4">
            <div className="flex items-start gap-3">
              <Truck size={18} className="mt-0.5 text-sky-400"/>
              <div><p className="font-semibold text-text">Entregas concluidas por agendamento e venda</p><p className="mt-1 text-sm text-muted">O valor exibido e integral: taxa do MotoDog no agendamento ou taxa de entrega da venda. Motoboys sao configurados manualmente, sem acesso ao sistema.</p></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {deliverySummary.map((item) => (
              <div key={item.staff_key} className="rounded-2xl border border-[var(--border)] bg-card p-5">
                <p className="font-display text-lg font-bold text-text">{item.staff_name}</p>
                <p className="mt-2 text-sm text-muted">{item.count} entrega(s)</p>
                <p className="mt-3 text-2xl font-black text-sky-400">{fmtCurrency(item.total)}</p>
              </div>
            ))}
          </div>

          <div className="tbl-wrapper overflow-x-auto">
            <table className="tbl min-w-[930px]">
              <thead><tr><th>Data</th><th>Motoboy</th><th>Cliente</th><th>Pet</th><th>Origem</th><th>Valor integral</th></tr></thead>
              <tbody>
                {deliveryRows.map((row) => (
                  <tr key={row.id}>
                    <td>{dateLabel(row.occurred_at)}</td>
                    <td>
                      {row.staff_key ? <span className="font-semibold text-text">{row.staff_name || row.staff_key}</span> : (
                        <select
                          className="inp min-w-[170px] text-xs"
                          defaultValue=""
                          disabled={assigningDeliveryId === row.id || assignableDeliveryStaff.length === 0}
                          onChange={(event) => event.target.value && void assignDelivery(row, event.target.value)}
                        >
                          <option value="">{assigningDeliveryId === row.id ? 'Salvando...' : 'Selecionar motoboy'}</option>
                          {assignableDeliveryStaff.map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="font-semibold text-text">{row.client_name}</td>
                    <td>{row.pet_name || '-'}</td>
                    <td>{row.source_label}</td>
                    <td className="font-bold text-sky-400">{fmtCurrency(row.delivery_value)}</td>
                  </tr>
                ))}
                {!deliveryRows.length && !loading && <tr><td colSpan={6} className="text-center text-muted py-10">Sem entregas concluidas no periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
