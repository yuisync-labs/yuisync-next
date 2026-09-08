import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckCircle,
  ClipboardList,
  CreditCard,
  Edit2,
  History,
  PackageCheck,
  Receipt,
  RefreshCw,
  Scissors,
  UserRound,
  Wallet,
} from 'lucide-react'

import { Card, Panel, ResponsiveDetailPanel } from '../../../components/ui'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { fmtCurrency } from '../../../lib/supabase'
import { listAppointmentsCommand } from '../lib/appointmentCommands'
import { appointmentPackagePresentation } from '../lib/appointmentBillingPresentation'
import {
  appointmentHistoryRows,
  appointmentPanelAction,
  appointmentPaymentPresentation,
} from '../lib/agendaPanelPresentation'
import { appointmentCheckoutTotals } from '../pages/appointmentCheckoutFlow'

const fmtDateTime = (value) => {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function serviceNames(appointment, serviceLabel) {
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  const labels = items.map((item) => item?.name || item?.label || item?.service_name || item?.code).filter(Boolean)
  return labels.length ? labels : [serviceLabel(appointment)].filter(Boolean)
}

function paymentToneClasses(tone) {
  if (tone === 'success') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
  if (tone === 'warning') return 'border-amber-500/25 bg-amber-500/10 text-amber-200'
  return 'border-[var(--border2)] bg-white/[0.03] text-text'
}

export function AgendaAppointmentPanel({
  appointment,
  staffById = new Map(),
  serviceLabel,
  statusBadge,
  transportOptions = [],
  needsPayment,
  onClose,
  onEdit,
  onStatus,
  onCompletedAction,
}) {
  const { activeTenantId } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [savingAction, setSavingAction] = useState(false)
  const [actionError, setActionError] = useState('')

  const packagePresentation = useMemo(
    () => appointmentPackagePresentation(appointment || {}),
    [appointment],
  )
  const totals = useMemo(
    () => appointmentCheckoutTotals(appointment || {}, transportOptions),
    [appointment, transportOptions],
  )
  const payment = useMemo(() => appointmentPaymentPresentation({
    appointment: appointment || {},
    needsPayment: appointment ? needsPayment(appointment) : false,
    total: totals.total,
    usesPackage: packagePresentation.usesPackage,
  }), [appointment, needsPayment, packagePresentation.usesPackage, totals.total])
  const nextAction = appointmentPanelAction(appointment?.status)
  const responsible = staffById.get(appointment?.responsible_staff_key)?.name
    || appointment?.responsible_staff_name
    || 'Sem responsável'
  const currentStatus = appointment ? statusBadge(appointment.status) : { cls: 'badge-gray', label: '-' }
  const services = serviceNames(appointment, serviceLabel)

  useEffect(() => {
    if (!appointment?.client_id || !activeTenantId || activeModuleId !== 'petshop') {
      setHistory([])
      setHistoryError('')
      setHistoryLoading(false)
      return undefined
    }

    let cancelled = false
    setHistoryLoading(true)
    setHistoryError('')
    listAppointmentsCommand({
      tenantId: activeTenantId,
      moduleId: activeModuleId,
      filters: { client_id: appointment.client_id, sort: 'desc', limit: 12 },
    }).then((items) => {
      if (!cancelled) setHistory(appointmentHistoryRows(items, appointment.id, 12))
    }).catch((error) => {
      if (!cancelled) setHistoryError(error?.message || 'Não foi possível carregar o histórico deste cliente.')
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false)
    })

    return () => { cancelled = true }
  }, [activeModuleId, activeTenantId, appointment?.client_id, appointment?.id, appointment?.updated_at])

  const runStatusAction = async () => {
    if (!appointment?.id || !nextAction || savingAction) return
    setSavingAction(true)
    setActionError('')
    try {
      await onStatus(appointment.id, nextAction.status)
    } catch (error) {
      setActionError(error?.message || 'Não foi possível atualizar este atendimento. O estado anterior foi mantido.')
    } finally {
      setSavingAction(false)
    }
  }

  if (!appointment) return null

  const footer = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-secondary flex-1 justify-center" onClick={() => onEdit(appointment)} disabled={savingAction}>
        <Edit2 size={14}/> Editar
      </button>
      {nextAction && (
        <button type="button" className="btn btn-primary flex-1 justify-center" onClick={() => void runStatusAction()} disabled={savingAction}>
          {savingAction ? <RefreshCw size={14} className="animate-spin"/> : <CheckCircle size={14}/>} {savingAction ? 'Salvando...' : nextAction.label}
        </button>
      )}
      {appointment.status === 'concluido' && (
        <button
          type="button"
          className="btn btn-primary flex-1 justify-center"
          disabled={savingAction}
          onClick={() => onCompletedAction(appointment)}
        >
          {needsPayment(appointment) ? <Wallet size={14}/> : <Receipt size={14}/>} {needsPayment(appointment) ? 'Receber' : 'Comprovante'}
        </button>
      )}
    </div>
  )

  return (
    <ResponsiveDetailPanel
      open
      busy={savingAction}
      title={appointment.pets?.pet_name || 'Atendimento'}
      description={`${appointment.pets?.owner_name || 'Cliente'} · ${fmtDateTime(appointment.scheduled_at)}`}
      onClose={onClose}
      footer={footer}
    >
      <div className="space-y-4" data-qa="agenda-appointment-panel">
        {actionError && (
          <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {actionError}
          </div>
        )}

        <Panel
          title="Atendimento"
          icon={ClipboardList}
          action={<span className={`badge ${currentStatus.cls}`}>{currentStatus.label}</span>}
          contentClassName="space-y-3"
        >
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 xl:grid-cols-1">
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted">Horário</p><p className="mt-1 font-semibold text-text">{fmtDateTime(appointment.scheduled_at)}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted">Origem</p><p className="mt-1 font-semibold text-text">{appointment.source || 'Atendimento'}</p></div>
          </div>
          {appointment.notes && <p className="whitespace-pre-wrap rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-100">{appointment.notes}</p>}
        </Panel>

        <Panel title="Serviços" icon={Scissors} contentClassName="space-y-2">
          {services.map((name, index) => (
            <Card key={`${name}-${index}`} tone="subtle" className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="min-w-0 font-semibold text-text">{name}</span>
              {appointment.service_items?.[index]?.benefit_used === true && <span className="badge badge-green shrink-0">Pacote</span>}
            </Card>
          ))}
        </Panel>

        <Panel title="Responsável" icon={UserRound}>
          <p className={appointment.responsible_staff_key || appointment.responsible_staff_name ? 'font-semibold text-text' : 'font-semibold text-amber-300'}>{responsible}</p>
        </Panel>

        <Panel title="Pacote" icon={PackageCheck}>
          {packagePresentation.usesPackage ? (
            <div className="space-y-2 text-sm">
              <span className="badge badge-green">Benefício do pacote</span>
              <p className="text-muted">Status do benefício: <strong className="text-text">{packagePresentation.benefitState || appointment.subscription_benefit_status || 'vinculado'}</strong></p>
              <p className="break-all text-xs text-muted">Assinatura: {appointment.subscription_id || appointment.billing_intent_subscription_id || 'identificada pelo atendimento'}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Atendimento avulso, sem serviço coberto por pacote.</p>
          )}
        </Panel>

        <Panel title="Pagamento" icon={CreditCard}>
          <div className={`rounded-xl border px-3 py-3 ${paymentToneClasses(payment.tone)}`}>
            <p className="font-semibold">{payment.label}</p>
            <p className="mt-1 text-xs opacity-80">{payment.detail ? payment.detail.replace(String(totals.total), fmtCurrency(totals.total)) : 'Sem informação adicional de cobrança.'}</p>
            {totals.discount > 0.005 && <p className="mt-1 text-xs opacity-80">Cobertura/desconto operacional: {fmtCurrency(totals.discount)}</p>}
          </div>
        </Panel>

        <Panel
          title="Histórico do cliente"
          icon={History}
          description="Últimos atendimentos carregados pelo Worker."
          action={historyLoading ? <RefreshCw size={14} className="animate-spin text-muted"/> : null}
          contentClassName="space-y-2"
        >
          {historyError && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{historyError}</p>}
          {!historyLoading && !historyError && history.length === 0 && <p className="text-sm text-muted">Nenhum atendimento anterior encontrado.</p>}
          {history.map((item) => {
            const badge = statusBadge(item.status)
            return (
              <Card key={item.id} tone={item.current ? 'info' : 'subtle'} className="p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-text">{serviceLabel(item)}</p>
                    <p className="mt-1 flex items-center gap-1 text-muted"><CalendarClock size={11}/> {fmtDateTime(item.scheduled_at)}</p>
                    <p className="mt-1 text-muted">{item.responsible_staff_name || staffById.get(item.responsible_staff_key)?.name || 'Sem responsável'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`badge ${badge.cls}`}>{item.current ? 'Atual' : badge.label}</span>
                    <p className="mt-1 font-semibold text-emerald-400">{fmtCurrency(item.price || 0)}</p>
                  </div>
                </div>
              </Card>
            )
          })}
        </Panel>
      </div>
    </ResponsiveDetailPanel>
  )
}

export default AgendaAppointmentPanel
