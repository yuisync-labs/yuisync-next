import { useEffect, useMemo, useState } from 'react'
import { Calendar, ClipboardList, MapPin, MessageSquare, Package, Printer, RefreshCw, Scissors, Truck, UserCheck } from 'lucide-react'
import { useAuthCtx } from '../../../context/AuthContext'
import { fmtCurrency, todayISO } from '../../../lib/supabase'
import { openReceiptPreview } from '../../../lib/receiptPrint'
import { SERVICE_ORDER_FLOW, usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import BanhoTosaPdvPanel from './BanhoTosaPdvPanel'
import { APPOINTMENT_CHECKOUT_EVENT, ORDERS_TAB_SESSION_KEY } from './appointmentCheckoutFlow'

function requestedInitialOrderType() {
  if (typeof window === 'undefined') return 'entrega'
  return window.sessionStorage.getItem(ORDERS_TAB_SESSION_KEY) === 'banho_tosa'
    ? 'banho_tosa'
    : 'entrega'
}

const ALL_STATUS_STEPS = [
  { id: 'pendente', label: 'Pendente' },
  { id: 'separacao', label: 'Separacao' },
  { id: 'agendado', label: 'Agendado' },
  { id: 'em_rota', label: 'Em rota' },
  { id: 'concluida', label: 'Concluida' },
]

function orderAddress(order) {
  return [
    order.delivery_address || order.client?.address || order.client?.owner_address,
    order.delivery_neighborhood || order.client?.neighborhood || order.client?.owner_neighborhood,
    order.delivery_city || order.client?.city || order.client?.owner_city,
  ].filter(Boolean).join(' - ')
}

function completeClientAddress(order) {
  const client = order.client || {}
  const details = client.details || {}
  const address = order.delivery_address || client.address || client.owner_address || ''
  const number = order.delivery_number || client.address_number || details.address_number || ''
  const complement = order.delivery_complement || client.address_complement || details.address_complement || ''
  const neighborhood = order.delivery_neighborhood || client.neighborhood || client.owner_neighborhood || ''
  const city = order.delivery_city || client.city || client.owner_city || ''
  const zipCode = order.delivery_zip_code || client.zip_code || details.zip_code || ''
  const reference = order.delivery_reference
    || client.address_reference
    || details.address_reference
    || extractNoteValue(order.notes || order.sale?.notes, 'Referência')
    || extractNoteValue(order.notes || order.sale?.notes, 'Referencia')
    || ''
  const streetLine = [address, number && `Nº ${number}`, complement].filter(Boolean).join(', ')
  const locationLine = [neighborhood && `Bairro ${neighborhood}`, city, zipCode && `CEP ${zipCode}`].filter(Boolean).join(' · ')
  return [streetLine, locationLine, reference && `Referência: ${reference}`].filter(Boolean).join(' · ')
}

function extractNoteValue(notes = '', label = '') {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(notes || '').match(new RegExp(`${escaped}:\\s*([^|]+)`, 'i'))
  return match?.[1]?.trim() || ''
}

function orderItems(order) {
  const saleItems = order.sale?.sale_items || []
  if (saleItems.length) {
    return saleItems.map((item) => ({
      name: item.products?.name || 'Produto sem vinculo',
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || 0),
      subtotal: Number(item.subtotal || Number(item.quantity || 1) * Number(item.unit_price || 0)),
    }))
  }

  const notesItems = extractNoteValue(order.notes || order.sale?.notes, 'Itens')
  if (!notesItems) return []
  return notesItems.split(';').map((entry) => ({ raw: entry.trim() })).filter((entry) => entry.raw)
}

function sourceLabel(order) {
  if (order.sale?.source === 'whatsapp' || String(order.notes || '').toLowerCase().includes('petbot')) return 'PetBot WhatsApp'
  if (order.sale?.source === 'pdv') return 'PDV'
  return order.sale?.source || order.source || 'Operacional'
}

function orderSessionId(order) {
  return order.session_id || extractNoteValue(order.notes || order.sale?.notes, 'Sessao')
}

function orderOriginAddress(order) {
  return orderAddress(order) || extractNoteValue(order.notes || order.sale?.notes, 'Endereco')
}

function orderCompletedAt(order) {
  return order.updated_at || order.sale?.created_at || order.created_at
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR')
}

function visibleOrderNotes(order) {
  return String(order.notes || order.sale?.notes || '')
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !/^(origem|sessao|itens|endereco|taxa de entrega):/i.test(entry))
    .join(' | ')
}

function paymentStatus(order) {
  return order.payment_status || order.sale?.payment_status || 'nao_aplicavel'
}

function paymentBadge(order) {
  const status = paymentStatus(order)
  if (status === 'aguardando_comprovante') return { label: 'Pix aguardando comprovante', cls: 'badge-amber' }
  if (status === 'comprovante_recebido') return { label: 'Comprovante recebido', cls: 'badge-blue' }
  if (status === 'baixado') return { label: 'Pagamento baixado', cls: 'badge-green' }
  return null
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

function printOrderReceipt(order, storeSettings = {}, fallbackItems = []) {
  const address = completeClientAddress(order) || orderOriginAddress(order)
  const directItems = orderItems(order)
  const items = directItems.length ? directItems : fallbackItems
  const publicNotes = visibleOrderNotes(order)
  const createdAt = order.created_at ? new Date(order.created_at).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')
  const total = Number(order.sale?.total_price || 0)
  const subtotal = Number(order.sale?.subtotal || 0)
  const discount = Number(order.sale?.discount || 0)
  const orderLabel = String(order.id || '').slice(0, 8)
  const saleLabel = String(order.sale_id || '').slice(0, 8) || '-'
  const itemRows = items.length ? items.map((item) => item.raw ? `
    <tr><td class="qty">1</td><td>${escapeHtml(item.raw)}</td><td class="money">-</td><td class="money">-</td></tr>
  ` : `
    <tr><td class="qty">${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.name)}</td><td class="money">${escapeHtml(fmtCurrency(item.unitPrice))}</td><td class="money">${escapeHtml(fmtCurrency(item.subtotal))}</td></tr>
  `).join('') : '<tr><td colspan="4">Sem itens vinculados nesta ordem.</td></tr>'
  const bodyHtml = `
    <div class="receipt-meta">Data: ${escapeHtml(createdAt)} · Ordem #${escapeHtml(orderLabel)} · Venda #${escapeHtml(saleLabel)} · Status: ${escapeHtml(order.status || '-')}</div>
    <section class="receipt-section">
      <div class="receipt-section-title">Cliente</div>
      <div class="receipt-row"><strong>Nome</strong><span>${escapeHtml(order.client?.owner_name || order.sale?.customer_name || 'Cliente')}</span></div>
      <div class="receipt-row"><strong>Telefone</strong><span>${escapeHtml(order.contact_phone || order.client?.phone || '-')}</span></div>
      ${order.client?.owner_cpf ? `<div class="receipt-row"><strong>CPF</strong><span>${escapeHtml(order.client.owner_cpf)}</span></div>` : ''}
      ${address ? `<div class="receipt-row"><strong>Endereco</strong><span>${escapeHtml(address)}</span></div>` : ''}
    </section>
    <section class="receipt-section"><div class="receipt-section-title">Itens</div><div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th class="qty">Qtd</th><th>Descricao</th><th class="money">Unit.</th><th class="money">Total</th></tr></thead><tbody>${itemRows}</tbody></table></div></section>
    <section class="receipt-section">
      ${subtotal > 0 ? `<div class="receipt-row"><strong>Subtotal</strong><span class="money">${escapeHtml(fmtCurrency(subtotal))}</span></div>` : ''}
      ${discount > 0 ? `<div class="receipt-row"><strong>Desconto</strong><span class="money">-${escapeHtml(fmtCurrency(discount))}</span></div>` : ''}
      <div class="receipt-total"><span>Total</span><span>${escapeHtml(fmtCurrency(total))}</span></div>
      <div class="receipt-row"><strong>Pagamento</strong><span>${escapeHtml(order.sale?.payment_method || '-')}</span></div>
      ${paymentStatus(order) !== 'nao_aplicavel' ? `<div class="receipt-row"><strong>Status pgto.</strong><span>${escapeHtml(paymentStatus(order))}</span></div>` : ''}
      ${publicNotes ? `<div class="receipt-row"><strong>Observacao</strong><span>${escapeHtml(publicNotes)}</span></div>` : ''}
    </section>
  `
  openReceiptPreview({
    storeSettings,
    title: order.order_type === 'servico' ? 'ORDEM DE SERVICO' : 'CONFERENCIA / ORDEM DE ENTREGA',
    bodyHtml,
  })
}

function OrderCard({ order, assignees, onAssign, onAdvance, onPrint, fallbackItems = [], setPage }) {
  const flow = SERVICE_ORDER_FLOW[order.order_type] || []
  const currentIndex = flow.findIndex((step) => step.id === order.status)
  const nextStep = flow[currentIndex + 1] || null
  const address = orderAddress(order)
  const directItems = orderItems(order)
  const items = directItems.length ? directItems : fallbackItems
  const clientAddress = completeClientAddress(order) || address || orderOriginAddress(order)
  const publicNotes = visibleOrderNotes(order)
  const ownerName = order.client?.owner_name || order.sale?.customer_name || 'Cliente'
  const petName = order.client?.pet_name && order.client.pet_name !== ownerName ? order.client.pet_name : ''
  const subtitle = petName ? `Pet: ${petName}` : sourceLabel(order)
  const payBadge = paymentBadge(order)

  return (
    <div className="bg-card border border-[var(--border)] rounded-2xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display font-bold text-lg text-text truncate">{ownerName}</p>
          <p className="text-xs text-muted truncate">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="badge badge-blue capitalize">{order.order_type}</span>
          {payBadge && <span className={`badge ${payBadge.cls}`}>{payBadge.label}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-1">Venda</p>
          <p className="text-text font-semibold">#{String(order.sale_id || '').slice(0, 8) || '-'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-1">Total</p>
          <p className="text-emerald-400 font-semibold">{fmtCurrency(order.sale?.total_price || 0)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-1">Contato</p>
          <p className="text-text">{order.contact_phone || order.client?.phone || '-'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-1">Criada em</p>
          <p className="text-text">{new Date(order.created_at).toLocaleString('pt-BR')}</p>
        </div>
      </div>

      <div className="rounded-xl bg-white/5 border border-[var(--border)] px-4 py-3 text-sm text-text">
        <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-2">Itens</p>
        {items.length ? (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${order.id}-item-${index}`} className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <Package size={15} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span className="text-sm leading-snug line-clamp-2">
                    {item.raw || `${item.quantity}x ${item.name}`}
                  </span>
                </div>
                {!item.raw && (
                  <span className="text-xs font-semibold text-muted whitespace-nowrap">{fmtCurrency(item.subtotal)}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-amber-500">Sem itens vinculados nesta ordem.</p>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-2">Responsavel</p>
        <select
          className="inp"
          value={order.assigned_to || ''}
          onChange={(event) => onAssign(order, event.target.value)}
        >
          <option value="">Sem responsavel</option>
          {assignees.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.full_name || profile.email}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl bg-white/5 border border-[var(--border)] px-4 py-3 text-sm text-text">
        <p className="text-[10px] uppercase tracking-widest text-muted font-bold mb-2">Endereço do cliente</p>
        <div className="flex items-start gap-2">
          <MapPin size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="leading-snug">{clientAddress || 'Endereço não informado no cadastro do cliente.'}</span>
        </div>
        <p className="text-[11px] text-muted mt-2">Canal: {sourceLabel(order)}</p>
        {order.transport_label && <p className="text-[11px] text-emerald-500 mt-1">MotoDog: {order.transport_label}</p>}
      </div>

      {publicNotes && (
        <div className="rounded-xl bg-white/5 border border-[var(--border)] px-4 py-3 text-sm text-muted">
          {publicNotes}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_44px_44px] gap-2">
        {nextStep ? (
          <button
            onClick={() => onAdvance(order, nextStep.id)}
            className="btn btn-primary min-w-0 justify-center px-3 text-xs"
            title={`Avancar para ${nextStep.label}`}
          >
            <Truck size={15} className="flex-shrink-0" />
            <span className="truncate">Avancar para {nextStep.label}</span>
          </button>
        ) : (
          <div className="min-w-0 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-3 text-xs text-emerald-400 text-center truncate">
            Ordem concluida
          </div>
        )}
        <button
          onClick={() => onPrint(order, items)}
          className="btn btn-secondary btn-icon h-11 w-11 justify-center"
          title="Imprimir ordem térmica"
          aria-label="Imprimir ordem térmica"
        >
          <Printer size={15} />
        </button>
        {setPage && (
          <button onClick={() => setPage('chat')} className="btn btn-secondary btn-icon h-11 w-11 justify-center" title="Abrir chat" aria-label="Abrir chat">
            <MessageSquare size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

function CompletedOrdersTable({ orders, onPrint, fallbackItemsForOrder, setPage }) {
  return (
    <div className="bg-card border border-[var(--border)] rounded-xl2 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl table-fixed min-w-[1120px]">
          <thead>
            <tr>
              <th className="w-[220px]">Cliente</th>
              <th className="w-[320px]">Itens</th>
              <th className="w-[120px]">Venda</th>
              <th className="w-[120px]">Total</th>
              <th className="w-[260px]">Endereço do cliente</th>
              <th className="w-[170px]">Concluida em</th>
              <th className="w-[120px]">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const ownerName = order.client?.owner_name || order.sale?.customer_name || 'Cliente'
              const petName = order.client?.pet_name && order.client.pet_name !== ownerName ? order.client.pet_name : ''
              const directItems = orderItems(order)
              const items = directItems.length ? directItems : fallbackItemsForOrder(order)
              const clientAddress = completeClientAddress(order) || orderAddress(order) || orderOriginAddress(order) || 'Endereço não informado'
              const firstItem = items[0]
              const extraCount = Math.max(0, items.length - 1)
              const payBadge = paymentBadge(order)

              return (
                <tr key={order.id}>
                  <td>
                    <p className="font-semibold text-text truncate">{ownerName}</p>
                    <p className="text-xs text-muted truncate">{petName ? `Pet: ${petName}` : order.contact_phone || order.client?.phone || '-'}</p>
                  </td>
                  <td>
                    {items.length ? (
                      <div className="flex items-start gap-2 min-w-0">
                        <Package size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm text-text truncate">
                            {firstItem.raw || `${firstItem.quantity}x ${firstItem.name}`}
                          </p>
                          <p className="text-xs text-muted">
                            {extraCount ? `+ ${extraCount} item(ns)` : firstItem.raw ? '' : fmtCurrency(firstItem.subtotal)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-amber-500">Sem itens vinculados</span>
                    )}
                  </td>
                  <td className="font-semibold text-text">#{String(order.sale_id || '').slice(0, 8) || '-'}</td>
                  <td>
                    <p className="font-semibold text-emerald-400">{fmtCurrency(order.sale?.total_price || 0)}</p>
                    {payBadge && <span className={`badge ${payBadge.cls} mt-1`}>{payBadge.label}</span>}
                  </td>
                  <td>
                    <div className="flex items-start gap-2 text-sm text-text">
                      <MapPin size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-2">{clientAddress}</span>
                    </div>
                  </td>
                  <td className="text-sm text-muted">{formatDateTime(orderCompletedAt(order))}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onPrint(order, items)}
                        className="btn btn-secondary btn-icon h-10 w-10 justify-center"
                        title="Imprimir ordem térmica"
                        aria-label="Imprimir ordem térmica"
                      >
                        <Printer size={15} />
                      </button>
                      {setPage && (
                        <button onClick={() => setPage('chat')} className="btn btn-secondary btn-icon h-10 w-10 justify-center" title="Abrir chat" aria-label="Abrir chat">
                          <MessageSquare size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function OrdensEntregaPage({ setPage }) {
  const { loadOrderAssignees, loadServiceOrders, updateServiceOrder } = usePetshopAdvanced()
  const { storeSettings } = useAuthCtx()
  const [orderType, setOrderType] = useState(requestedInitialOrderType)
  const [activeOrders, setActiveOrders] = useState([])
  const [completedOrders, setCompletedOrders] = useState([])
  const [historyDate, setHistoryDate] = useState(todayISO())
  const [assignees, setAssignees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function reload(nextOrderType = orderType, nextHistoryDate = historyDate) {
    setLoading(true)
    setError('')
    try {
      const [activeRows, completedRows, profileRows] = await Promise.all([
        loadServiceOrders({
          orderType: nextOrderType || '',
          excludeStatus: 'concluida',
          date: todayISO(),
          dateField: 'created_at',
          limit: 120,
        }),
        loadServiceOrders({
          orderType: nextOrderType || '',
          status: 'concluida',
          date: nextHistoryDate,
          dateField: 'updated_at',
          limit: 200,
        }),
        loadOrderAssignees(),
      ])
      setActiveOrders(activeRows)
      setCompletedOrders(completedRows)
      setAssignees(profileRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (orderType === 'banho_tosa') {
      setLoading(false)
      return
    }
    reload(orderType, historyDate)
  }, [orderType, historyDate])

  useEffect(() => {
    const openQueuedCheckout = () => {
      if (window.sessionStorage.getItem(ORDERS_TAB_SESSION_KEY) === 'banho_tosa') {
        setOrderType('banho_tosa')
      }
    }
    openQueuedCheckout()
    window.addEventListener(APPOINTMENT_CHECKOUT_EVENT, openQueuedCheckout)
    window.addEventListener('focus', openQueuedCheckout)
    return () => {
      window.removeEventListener(APPOINTMENT_CHECKOUT_EVENT, openQueuedCheckout)
      window.removeEventListener('focus', openQueuedCheckout)
    }
  }, [])

  useEffect(() => {
    if (orderType === 'banho_tosa') {
      window.sessionStorage.removeItem(ORDERS_TAB_SESSION_KEY)
    }
  }, [orderType])

  async function handleAssign(order, assignedTo) {
    try {
      await updateServiceOrder(order, { assigned_to: assignedTo || null })
      await reload(orderType, historyDate)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleAdvance(order, nextStatus) {
    try {
      await updateServiceOrder(order, { status: nextStatus })
      await reload(orderType, historyDate)
    } catch (err) {
      setError(err.message)
    }
  }

  const itemsBySession = useMemo(() => {
    const map = new Map()
    ;[...activeOrders, ...completedOrders].forEach((order) => {
      const sessionId = orderSessionId(order)
      const items = orderItems(order)
      if (sessionId && items.length && !map.has(sessionId)) {
        map.set(sessionId, items)
      }
    })
    return map
  }, [activeOrders, completedOrders])

  function handlePrint(order, fallbackItems = []) {
    printOrderReceipt(order, storeSettings, fallbackItems)
  }

  const steps = (orderType ? (SERVICE_ORDER_FLOW[orderType] || ALL_STATUS_STEPS) : ALL_STATUS_STEPS).filter((step) => step.id !== 'concluida')
  const pendingCount = activeOrders.filter((order) => ['pendente', 'separacao', 'agendado'].includes(order.status)).length
  const routeCount = activeOrders.filter((order) => order.status === 'em_rota').length
  const doneCount = completedOrders.length
  const totalValue = useMemo(
    () => [...activeOrders, ...completedOrders].reduce((sum, order) => sum + Number(order.sale?.total_price || 0), 0),
    [activeOrders, completedOrders]
  )

  return (
    <div className="page animate-fade-up space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ClipboardList size={22} className="text-amber-400" />
            Ordens de Servico / Entrega
          </h1>
          <p className="page-sub">Fila operacional nascida das vendas por WhatsApp, com dono, rota e status.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => reload(orderType, historyDate)} className="btn btn-secondary">
            <RefreshCw size={15} /> Atualizar
          </button>
          {setPage && (
            <button onClick={() => setPage('vendas')} className="btn btn-secondary">
              <Truck size={15} /> Ir para Vendas
            </button>
          )}
        </div>
      </div>

      <div className="flex bg-white/5 border border-white/5 rounded-xl p-1 w-fit">
        {[
          { id: 'entrega', label: 'Entregas' },
          { id: 'servico', label: 'Ordens de servico' },
          { id: 'banho_tosa', label: 'Banho & Tosa', icon: Scissors },
        ].map((item) => {
          const Icon = item.icon
          return (
          <button
            key={item.id}
            onClick={() => setOrderType(item.id)}
            className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition-all ${
              orderType === item.id ? 'bg-primary text-gray-950 shadow-lg' : 'text-muted hover:text-text'
            }`}
            style={orderType === item.id ? { backgroundColor: 'var(--primary)' } : {}}
          >
            {Icon && <Icon size={14} />}
            {item.label}
          </button>
          )
        })}
      </div>

      {orderType === 'banho_tosa' ? (
        <section data-yuisync-native-banho-tosa-tab className="space-y-6">
          <BanhoTosaPdvPanel setPage={setPage} />
        </section>
      ) : (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-card px-4 py-3">
        <div>
          <p className="text-sm font-bold text-text">Operacao ativa de hoje</p>
          <p className="text-xs text-muted">Cards mostram apenas ordens abertas criadas hoje. Concluidas ficam no historico abaixo.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-muted uppercase tracking-widest">
          <Calendar size={15} className="text-amber-400" />
          Historico
          <input
            type="date"
            className="inp py-2 w-auto normal-case tracking-normal"
            value={historyDate}
            onChange={(event) => setHistoryDate(event.target.value || todayISO())}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Na fila</p>
          <p className="font-display font-bold text-3xl text-text">{pendingCount}</p>
        </div>
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Em rota</p>
          <p className="font-display font-bold text-3xl text-sky-400">{routeCount}</p>
        </div>
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Concluidas na data</p>
          <p className="font-display font-bold text-3xl text-emerald-400">{doneCount}</p>
        </div>
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Valor em ordens</p>
          <p className="font-display font-bold text-3xl text-amber-400">{fmtCurrency(totalValue)}</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="text-sm text-muted flex items-center gap-2">
          <RefreshCw size={15} className="animate-spin" /> Carregando ordens operacionais...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {steps.map((step) => (
              <div key={step.id} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-text">{step.label}</p>
                    <p className="text-xs text-muted">
                      {(SERVICE_ORDER_FLOW[orderType] || []).find((item) => item.id === step.id)?.hint || 'Acompanhamento operacional'}
                    </p>
                  </div>
                  <span className="badge badge-gray">{activeOrders.filter((order) => order.status === step.id).length}</span>
                </div>

                <div className="space-y-3">
                  {activeOrders
                    .filter((order) => order.status === step.id)
                    .map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        assignees={assignees}
                        onAssign={handleAssign}
                        onAdvance={handleAdvance}
                        onPrint={handlePrint}
                        fallbackItems={itemsBySession.get(orderSessionId(order)) || []}
                        setPage={setPage}
                      />
                    ))}

                  {!activeOrders.some((order) => order.status === step.id) && (
                    <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-muted text-sm">
                      <UserCheck size={20} className="mx-auto mb-2 opacity-50" />
                      Nada neste status agora.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-bold text-text">Historico de concluidas</p>
                <p className="text-xs text-muted">
                  Ordens concluidas em {new Date(`${historyDate}T00:00:00`).toLocaleDateString('pt-BR')}, em formato compacto para consulta e impressao.
                </p>
              </div>
              <span className="badge badge-green">{completedOrders.length} concluida(s)</span>
            </div>

            {completedOrders.length ? (
              <CompletedOrdersTable
                orders={completedOrders}
                onPrint={handlePrint}
                fallbackItemsForOrder={(order) => itemsBySession.get(orderSessionId(order)) || []}
                setPage={setPage}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-muted text-sm">
                <UserCheck size={20} className="mx-auto mb-2 opacity-50" />
                Nenhuma ordem concluida nesta data.
              </div>
            )}
          </section>
        </>
      )}
        </>
      )}
    </div>
  )
}
