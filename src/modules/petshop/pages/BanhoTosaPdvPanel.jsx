import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Banknote,
  Calendar,
  CheckCircle2,
  CreditCard,
  PawPrint,
  RefreshCw,
  Scissors,
  Smartphone,
  Wallet,
} from 'lucide-react'

import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { fmtCurrency, supabase } from '../../../lib/supabase'
import { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'
import { listAppointmentsCommand } from '../lib/appointmentCommands'
import { normalizeTransportOptions } from './agendaOperationalCore'
import {
  APPOINTMENT_CHECKOUT_EVENT,
  appointmentCheckoutTotals,
  clearQueuedAppointmentCheckout,
  readQueuedAppointmentCheckout,
} from './appointmentCheckoutFlow'
import {
  appointmentHasTransportBenefit,
  appointmentServiceNames,
  isGroomingAppointment,
} from '../lib/appointmentPackageUi'

const PAYMENT_METHODS = [
  { value: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { value: 'debito', label: 'Debito', icon: CreditCard },
  { value: 'credito', label: 'Credito', icon: CreditCard },
  { value: 'pix', label: 'Pix', icon: Smartphone },
]

const PAYMENT_LABELS = Object.fromEntries([
  ...PAYMENT_METHODS.map((item) => [item.value, item.label]),
  ['multiplo', 'Pagamento dividido'],
  ['pacote', 'Sem cobranca - pacote'],
])

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function dateBounds(value) {
  return {
    start: new Date(`${value}T00:00:00`).toISOString(),
    end: new Date(`${value}T23:59:59.999`).toISOString(),
  }
}

function mapAppointment(row = {}) {
  const client = row.clients || {}
  const details = client.details || {}
  const pet = row.pets || {}
  return {
    ...row,
    client: {
      id: client.id || row.client_id,
      owner_name: pet.owner_name || client.name || 'Cliente',
      phone: pet.phone || client.phone || '',
      pet_name: pet.pet_name || details.pet_name || 'Pet',
      breed: pet.breed || pet.species || details.breed || details.species || '',
    },
    clients: undefined,
  }
}

function splitTotal(splits = []) {
  return splits.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0)
}

function AppointmentFinanceCard({
  appointment,
  sale,
  totals,
  highlighted,
  checkingOut,
  active,
  paymentMethod,
  splitEnabled,
  splits,
  error,
  onOpen,
  onClose,
  onPaymentMethod,
  onSplitEnabled,
  onSplitChange,
  onCheckout,
}) {
  const names = appointmentServiceNames(appointment)
  const completedAt = sale?.created_at || appointment.updated_at || appointment.scheduled_at
  const zeroTotal = totals.total <= 0.005

  return (
    <article data-yuisync-appointment-checkout={appointment.id} className={`rounded-2xl border p-4 ${highlighted ? 'ring-2 ring-amber-400/60' : ''} ${sale || zeroTotal ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : 'border-[var(--border)] bg-card'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-black text-text">
            <PawPrint size={16} className="text-amber-400" />
            {appointment.client.pet_name}
          </p>
          <p className="mt-1 text-sm font-semibold text-text">Tutor: {appointment.client.owner_name}</p>
          <p className="text-xs text-muted">{appointment.client.breed || appointment.client.phone || 'Cadastro sem detalhes adicionais'}</p>
        </div>
        {sale ? (
          <span className="badge badge-green">Lancado no caixa</span>
        ) : zeroTotal ? (
          <span className="badge badge-blue">Coberto pelo pacote</span>
        ) : (
          <span className="badge badge-amber">Aguardando pagamento</span>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border2)] bg-white/[0.03] p-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted">Servicos realizados</p>
        <div className="mt-2 space-y-1">
          {names.map((name) => <p key={name} className="text-sm font-semibold text-text">{name}</p>)}
        </div>
        {appointment.notes && (
          <div className="mt-3 border-t border-[var(--border2)] pt-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted">Instrucoes para o profissional</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-text">{appointment.notes}</p>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Catalogo</p>
          <p className="mt-1 font-bold text-text">{fmtCurrency(totals.catalogTotal)}</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Pacote/desconto</p>
          <p className="mt-1 font-bold text-sky-400">-{fmtCurrency(totals.discount)}</p>
        </div>
        <div className="rounded-xl bg-emerald-500/10 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">A receber</p>
          <p className="mt-1 font-black text-emerald-400">{fmtCurrency(totals.total)}</p>
        </div>
      </div>

      {sale ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm">
          <div>
            <p className="font-bold text-emerald-300">Pagamento conferido</p>
            <p className="text-xs text-muted">{PAYMENT_LABELS[sale.payment_method] || sale.payment_method || 'Nao informado'} · {new Date(completedAt).toLocaleString('pt-BR')}</p>
          </div>
          <strong className="text-emerald-300">Venda #{String(sale.id || '').slice(0, 8)}</strong>
        </div>
      ) : zeroTotal ? (
        <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-bold text-emerald-300"><CheckCircle2 size={15} /> Beneficio consumido pelo pacote</p>
          <p className="mt-1 text-xs text-muted">Nenhuma cobranca adicional e nenhuma nova receita. O valor ja entrou no caixa na ativacao do pacote.</p>
        </div>
      ) : active ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted">Forma de pagamento</p>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon
                const selected = !splitEnabled && paymentMethod === method.value
                return (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => onPaymentMethod(method.value)}
                    className={`rounded-xl border px-3 py-3 text-left text-xs font-bold transition-colors ${selected ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border2)] bg-white/[0.03] text-muted hover:text-text'}`}
                  >
                    <Icon size={15} className="mb-2" />
                    {method.label}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-text">
            <input
              type="checkbox"
              checked={splitEnabled}
              onChange={(event) => onSplitEnabled(event.target.checked)}
            />
            Dividir pagamento em duas formas
          </label>

          {splitEnabled && (
            <div className="grid gap-3 md:grid-cols-2">
              {splits.map((split, index) => (
                <div key={index} className="grid grid-cols-[1fr_120px] gap-2">
                  <select
                    className="inp"
                    value={split.method}
                    onChange={(event) => onSplitChange(index, 'method', event.target.value)}
                  >
                    {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                  </select>
                  <input
                    aria-label={`Valor da forma ${index + 1}`}
                    className="inp"
                    type="number"
                    min="0"
                    step="0.01"
                    value={split.amount}
                    onChange={(event) => onSplitChange(index, 'amount', event.target.value)}
                    placeholder="0,00"
                  />
                </div>
              ))}
              <p className="text-xs text-muted md:col-span-2">
                Informado: {fmtCurrency(splitTotal(splits))} · Necessario: {fmtCurrency(totals.total)}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="button" disabled={checkingOut} onClick={onCheckout} className="btn btn-primary flex-1 justify-center">
              <CheckCircle2 size={15} /> {checkingOut ? 'Lancando...' : 'Confirmar pagamento'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onOpen} className="btn btn-primary mt-4 w-full justify-center">
          <Wallet size={15} /> Conferir pagamento e lancar no caixa
        </button>
      )}
    </article>
  )
}

export default function BanhoTosaPdvPanel({ setPage }) {
  const { activeTenantId, storeSettings } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const moduleId = activeModuleId || 'petshop'
  const initialCheckoutTarget = useMemo(() => readQueuedAppointmentCheckout(), [])
  const [date, setDate] = useState(initialCheckoutTarget?.date || localDate())
  const [focusedId, setFocusedId] = useState(initialCheckoutTarget?.appointment_id || null)
  const [appointments, setAppointments] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState('dinheiro')
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [splits, setSplits] = useState([
    { method: 'dinheiro', amount: '' },
    { method: 'pix', amount: '' },
  ])
  const [checkoutError, setCheckoutError] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)
  const loadSequence = useRef(0)
  const checkoutInFlight = useRef(false)
  const viewKey = `${activeTenantId}:${moduleId}:${date}`
  const currentView = useRef(viewKey)
  currentView.current = viewKey
  const transportOptions = useMemo(() => normalizeTransportOptions(storeSettings), [storeSettings])
  const runScoped = useCallback(
    (runner) => runWithTenantFallback(activeTenantId, runner),
    [activeTenantId],
  )

  const syncQueuedCheckout = useCallback(() => {
    const target = readQueuedAppointmentCheckout()
    if (!target?.appointment_id) return
    if (target.date) setDate(target.date)
    setFocusedId(String(target.appointment_id))
  }, [])

  useEffect(() => {
    syncQueuedCheckout()
    window.addEventListener(APPOINTMENT_CHECKOUT_EVENT, syncQueuedCheckout)
    window.addEventListener('focus', syncQueuedCheckout)
    return () => {
      window.removeEventListener(APPOINTMENT_CHECKOUT_EVENT, syncQueuedCheckout)
      window.removeEventListener('focus', syncQueuedCheckout)
    }
  }, [syncQueuedCheckout])

  const reload = useCallback(async () => {
    if (!activeTenantId || currentView.current !== viewKey) return
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    try {
      const { start, end } = dateBounds(date)
      const rows = await listAppointmentsCommand({
        tenantId: activeTenantId,
        moduleId,
        filters: { start, end, status: 'concluido' },
      })
      let appointmentRows = rows
        .map(mapAppointment)
        .filter(isGroomingAppointment)
      const ids = appointmentRows.map((appointment) => appointment.id)
      let saleRows = []
      if (ids.length) {
        const salesResponse = await runScoped(async (includeTenant) => {
          let query = supabase
            .from('sales')
            .select('id,appointment_id,total_price,subtotal,discount,payment_method,status,created_at')
            .eq('module_id', moduleId)
            .eq('status', 'concluido')
            .in('appointment_id', ids)
            .limit(ids.length)
          return applyTenantFilter(query, activeTenantId, includeTenant)
        })
        if (salesResponse.error) throw salesResponse.error
        saleRows = salesResponse.data || []
      }

      const soldAppointmentIds = new Set(saleRows.map((sale) => String(sale.appointment_id)))
      appointmentRows = await Promise.all(appointmentRows.map(async (appointment) => {
        if (soldAppointmentIds.has(String(appointment.id))) return appointment
        const reconciliation = await supabase.rpc('reconcile_petshop_completed_appointment_package', {
          p_appointment_id: appointment.id,
        })
        if (reconciliation.error) {
          const message = String(reconciliation.error.message || '')
          if (message.includes('reconcile_petshop_completed_appointment_package')) {
            throw new Error('Aplique a migration 20260729172000_petshop_checkout_package_reconciliation.sql antes de usar o fechamento.')
          }
          throw reconciliation.error
        }
        const reconciled = reconciliation.data?.appointment
        return reconciled ? { ...appointment, ...reconciled, client: appointment.client } : appointment
      }))

      if (sequence !== loadSequence.current) return
      setAppointments(appointmentRows)
      setSales(saleRows)
    } catch (error) {
      if (sequence !== loadSequence.current) return
      const message = String(error?.message || '')
      setLoadError(message.includes('appointment_id')
        ? 'Aplique a migration 20260729093000_petshop_appointment_pdv_checkout.sql antes de usar o fechamento.'
        : message || 'Nao foi possivel carregar os atendimentos concluidos.')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [activeTenantId, date, moduleId, runScoped, viewKey])

  useEffect(() => { void reload(); return () => { loadSequence.current += 1 } }, [reload])

  const salesByAppointment = useMemo(
    () => new Map(sales.map((sale) => [String(sale.appointment_id), sale])),
    [sales],
  )

  const totalsFor = useCallback(
    (appointment) => appointmentCheckoutTotals(appointment, transportOptions),
    [transportOptions],
  )

  const openCheckout = useCallback((appointment, totals) => {
    setActiveId(appointment.id)
    setPaymentMethod('dinheiro')
    setSplitEnabled(false)
    setCheckoutError('')
    setSplits([
      { method: 'dinheiro', amount: totals.total ? totals.total.toFixed(2) : '' },
      { method: 'pix', amount: '' },
    ])
  }, [])

  function updateSplit(index, key, value) {
    setSplits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  }

  async function checkout(appointment, totals) {
    if (checkoutInFlight.current) return
    checkoutInFlight.current = true
    setCheckingOut(true)
    setCheckoutError('')
    try {
      const paymentSplits = splitEnabled
        ? splits
          .filter((item) => Number(item.amount || 0) > 0)
          .map((item, index) => ({ method: item.method, amount: Number(item.amount), position: index + 1 }))
        : []

      if (splitEnabled && Math.abs(splitTotal(paymentSplits) - totals.total) > 0.01) {
        throw new Error('Os pagamentos divididos precisam fechar exatamente o valor do atendimento.')
      }

      const response = await supabase.rpc('checkout_petshop_appointment_transaction', {
        p_payload: {
          tenant_id: activeTenantId,
          module_id: moduleId,
          appointment_id: appointment.id,
          payment_method: paymentMethod,
          payment_splits: paymentSplits,
          transport_fee: totals.transport,
          transport_catalog_fee: totals.catalogTransport,
          notes: 'Fechamento confirmado em Ordens / Banho & Tosa',
        },
      })
      if (response.error) throw response.error
      if (!response.data?.sale_id) throw new Error('O servidor não confirmou o pagamento. Atualize a lista antes de tentar novamente.')

      setActiveId(null)
      setFocusedId(null)
      clearQueuedAppointmentCheckout()
      await reload()
    } catch (error) {
      setCheckoutError(error?.message || 'Nao foi possivel lancar o atendimento no caixa.')
    } finally {
      checkoutInFlight.current = false
      setCheckingOut(false)
    }
  }

  const financialState = useMemo(() => appointments.map((appointment) => ({
    appointment,
    sale: salesByAppointment.get(String(appointment.id)) || null,
    totals: totalsFor(appointment),
  })), [appointments, salesByAppointment, totalsFor])

  useEffect(() => {
    if (!focusedId || loading) return
    const entry = financialState.find((item) => String(item.appointment.id) === String(focusedId))
    if (!entry) return
    if (entry.sale || entry.totals.total <= 0.005) {
      clearQueuedAppointmentCheckout()
      setFocusedId(null)
      return
    }
    openCheckout(entry.appointment, entry.totals)
    setFocusedId(null)
    clearQueuedAppointmentCheckout()
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-yuisync-appointment-checkout="${entry.appointment.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [financialState, focusedId, loading, openCheckout])

  const pendingCount = financialState.filter((entry) => !entry.sale && entry.totals.total > 0.005).length
  const packageCount = financialState.filter((entry) => !entry.sale && entry.totals.total <= 0.005).length
  const paidCount = financialState.filter((entry) => entry.sale).length
  const totalReceived = sales.reduce((sum, sale) => sum + Number(sale.total_price || 0), 0)

  return (
    <section className="space-y-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-text"><Scissors size={20} className="text-amber-400" /> Banho & Tosa</h2>
          <p className="mt-1 text-sm text-muted">Pacotes cobertos apenas consomem o saldo. Somente valores extras ou atendimentos avulsos entram para pagamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-card px-3 py-2 text-xs font-bold text-muted">
            <Calendar size={14} className="text-amber-400" />
            <input type="date" className="bg-transparent text-text outline-none" value={date} onChange={(event) => setDate(event.target.value || localDate())} />
          </label>
          <button type="button" onClick={() => void reload()} className="btn btn-secondary"><RefreshCw size={15} /> Atualizar</button>
          {setPage && <button type="button" onClick={() => setPage('caixa')} className="btn btn-secondary"><Wallet size={15} /> Abrir Caixa</button>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-black uppercase tracking-widest text-muted">Aguardando pagamento</p><p className="mt-2 text-3xl font-black text-amber-400">{pendingCount}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-black uppercase tracking-widest text-muted">Cobertos pelo pacote</p><p className="mt-2 text-3xl font-black text-sky-400">{packageCount}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-black uppercase tracking-widest text-muted">Lancados no caixa</p><p className="mt-2 text-3xl font-black text-emerald-400">{paidCount}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-black uppercase tracking-widest text-muted">Receita de extras/avulsos</p><p className="mt-2 text-3xl font-black text-violet-400">{fmtCurrency(totalReceived)}</p></div>
      </div>

      {loadError && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{loadError}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted"><RefreshCw size={15} className="animate-spin" /> Carregando atendimentos concluidos...</div>
      ) : financialState.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {financialState.map(({ appointment, sale, totals }) => (
            <AppointmentFinanceCard
              key={appointment.id}
              appointment={appointment}
              sale={sale}
              totals={totals}
              highlighted={String(focusedId || activeId || '') === String(appointment.id)}
              checkingOut={checkingOut}
              active={activeId === appointment.id}
              paymentMethod={paymentMethod}
              splitEnabled={splitEnabled}
              splits={splits}
              error={activeId === appointment.id ? checkoutError : ''}
              onOpen={() => openCheckout(appointment, totals)}
              onClose={() => setActiveId(null)}
              onPaymentMethod={(method) => { setPaymentMethod(method); setSplitEnabled(false) }}
              onSplitEnabled={setSplitEnabled}
              onSplitChange={updateSplit}
              onCheckout={() => void checkout(appointment, totals)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-12 text-center text-sm text-muted">
          Nenhum atendimento de Banho & Tosa concluido nesta data.
        </div>
      )}
    </section>
  )
}
