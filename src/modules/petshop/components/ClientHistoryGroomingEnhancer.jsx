import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, PawPrint, Scissors, ShoppingBag, Truck, X } from 'lucide-react'

import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { supabase } from '../../../lib/supabase'
import { applyTenantFilter, runWithTenantFallback } from '../../../lib/tenant'
import { groupPetsByTutor } from '../../../shared/lib/petTutorGroups'

const GROOMING_MACHINE_OPTIONS = [4, 7, 10]
const FINAL_STATUSES = new Set(['concluido', 'completed', 'finalizado', 'finalizada'])

const normalize = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()

const fmtMoney = (value = 0) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const fmtDateTime = (value) => {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function mapClient(client = {}) {
  return {
    ...client,
    owner_name: client.name || '',
    owner_cpf: client.document || '',
    tutor_group_id: client?.details?.tutor_group_id || '',
    pet_name: String(client?.details?.pet_name || '').trim() || 'Pet',
  }
}

function groupClients(clients = []) {
  const groups = new Map()
  groupPetsByTutor(clients).forEach((group) => {
    groups.set(group.key, {
      key: group.key,
      owner_name: group.owner_name || 'Cliente',
      phone: group.phone || '',
      clients: group.pets,
    })
  })
  return groups
}

function serviceLabel(appointment, serviceMap) {
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  const labels = items.map((item) => {
    const code = item?.code || item?.service_code || item?.service_type
    return item?.name || item?.label || item?.service_name || serviceMap.get(String(code || '')) || code
  }).filter(Boolean)
  if (labels.length) return labels.join(' + ')
  return serviceMap.get(String(appointment?.service_type || '')) || appointment?.service_type || 'Serviço'
}

function deliveryLabelFromAppointment(appointment = {}) {
  const mode = normalize(appointment.transport_mode)
  if (!mode || mode === 'cliente_leva') return ''
  const label = appointment.transport_label || 'MotoDog'
  const address = [appointment.transport_address, appointment.transport_neighborhood, appointment.transport_city]
    .filter(Boolean)
    .join(' - ')
  return address ? `${label}: ${address}` : label
}

function deliveryLabelFromSale(sale = {}) {
  const fulfillment = normalize(sale.fulfillment_type)
  if (!fulfillment || ['balcao', 'retirada', 'servico'].includes(fulfillment)) return ''
  return fulfillment.includes('entrega') ? 'Entrega' : sale.fulfillment_type
}

function saleItemsLabel(sale = {}) {
  const items = Array.isArray(sale.sale_items) ? sale.sale_items : []
  const labels = items.map((item) => {
    const product = Array.isArray(item.products) ? item.products[0] : item.products
    const name = product?.name || 'Produto'
    const quantity = Number(item.quantity || 1)
    return `${quantity}x ${name}`
  }).filter(Boolean)
  return labels.join(' + ') || sale.notes || 'Compra'
}

function statusLabel(value = '') {
  const key = normalize(value)
  return {
    agendado: 'Agendado',
    confirmado: 'Confirmado',
    em_andamento: 'Em andamento',
    concluido: 'Concluído',
    completed: 'Concluído',
    finalizado: 'Concluído',
    cancelado: 'Cancelado',
    no_show: 'No-show',
  }[key] || value || '-'
}

async function tenantQuery(tenantId, callback) {
  return runWithTenantFallback(tenantId, async (includeTenant) => callback(includeTenant))
}

async function loadHistory(moduleId, tenantId, group) {
  const clients = Array.isArray(group?.clients) ? group.clients : []
  const clientIds = clients.map((client) => client.id).filter(Boolean)
  if (!clientIds.length) return []

  const petById = new Map(clients.map((client) => [String(client.id), client.pet_name]))

  const appointmentQuery = async (includeMachine = true) => tenantQuery(tenantId, async (includeTenant) => {
    const fields = [
      'id', 'client_id', 'service_type', 'service_items', 'scheduled_at', 'status', 'price', 'source', 'notes',
      'transport_mode', 'transport_label', 'transport_address', 'transport_neighborhood', 'transport_city',
      includeMachine ? 'grooming_machine_no' : null,
    ].filter(Boolean).join(',')
    let query = supabase
      .from('appointments')
      .select(fields)
      .eq('module_id', moduleId)
      .in('client_id', clientIds)
      .order('scheduled_at', { ascending: false })
      .limit(100)
    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })

  let appointmentsResponse = await appointmentQuery(true)
  if (appointmentsResponse.error && normalize(appointmentsResponse.error.message).includes('grooming_machine_no')) {
    appointmentsResponse = await appointmentQuery(false)
  }

  const [salesResponse, servicesResponse] = await Promise.all([
    tenantQuery(tenantId, async (includeTenant) => {
      let query = supabase
        .from('sales')
        .select('id,client_id,appointment_id,total_price,status,source,fulfillment_type,delivery_fee,notes,created_at,sale_items(quantity,unit_price,subtotal,products(name,category))')
        .eq('module_id', moduleId)
        .in('client_id', clientIds)
        .order('created_at', { ascending: false })
        .limit(100)
      query = applyTenantFilter(query, tenantId, includeTenant)
      return query
    }),
    tenantQuery(tenantId, async (includeTenant) => {
      let query = supabase
        .from('petshop_services')
        .select('id,code,name')
        .eq('module_id', moduleId)
      query = applyTenantFilter(query, tenantId, includeTenant)
      return query
    }),
  ])

  if (appointmentsResponse.error) throw appointmentsResponse.error
  if (salesResponse.error) throw salesResponse.error
  if (servicesResponse.error) throw servicesResponse.error

  const serviceMap = new Map()
  ;(servicesResponse.data || []).forEach((service) => {
    if (service.id) serviceMap.set(String(service.id), service.name || service.code)
    if (service.code) serviceMap.set(String(service.code), service.name || service.code)
  })

  const sales = salesResponse.data || []
  const saleByAppointment = new Map(sales
    .filter((sale) => sale.appointment_id)
    .map((sale) => [String(sale.appointment_id), sale]))

  const appointmentRows = (appointmentsResponse.data || []).map((appointment) => {
    const linkedSale = saleByAppointment.get(String(appointment.id))
    const machine = Number(appointment.grooming_machine_no || 0)
    const baseLabel = serviceLabel(appointment, serviceMap)
    return {
      id: `appointment:${appointment.id}`,
      kind: 'service',
      date: appointment.scheduled_at,
      pet: petById.get(String(appointment.client_id)) || 'Pet',
      title: machine ? `${baseLabel} - Nº ${machine}` : baseLabel,
      status: statusLabel(appointment.status),
      final: FINAL_STATUSES.has(normalize(appointment.status)),
      value: Number(linkedSale?.total_price ?? appointment.price ?? 0),
      delivery: deliveryLabelFromAppointment(appointment),
      instructions: String(appointment.notes || '').trim(),
      machine: machine || null,
    }
  })

  const purchaseRows = sales
    .filter((sale) => !sale.appointment_id)
    .map((sale) => ({
      id: `sale:${sale.id}`,
      kind: 'purchase',
      date: sale.created_at,
      pet: petById.get(String(sale.client_id)) || 'Cliente',
      title: saleItemsLabel(sale),
      status: statusLabel(sale.status),
      final: FINAL_STATUSES.has(normalize(sale.status)),
      value: Number(sale.total_price || 0),
      delivery: deliveryLabelFromSale(sale),
      instructions: '',
      machine: null,
    }))

  return [...appointmentRows, ...purchaseRows]
    .sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0))
}

function HistoryModal({ group, rows, loading, error, onClose }) {
  const clients = Array.isArray(group?.clients) ? group.clients : []
  const lastFinal = rows.find((row) => row.final)
  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-3xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Histórico do cliente</h2>
            <p className="mt-1 text-sm text-muted">
              {group?.owner_name || 'Cliente'}
              {clients.length ? ` · ${clients.map((client) => client.pet_name).join(', ')}` : ''}
            </p>
          </div>
          <button type="button" aria-label="Fechar histórico" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-muted">Registros</p><strong className="mt-2 block text-2xl text-text">{rows.length}</strong></div>
            <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-muted">Último valor finalizado</p><strong className="mt-2 block text-2xl text-emerald-400">{lastFinal ? fmtMoney(lastFinal.value) : '-'}</strong></div>
            <div className="rounded-xl border border-[var(--border)] bg-card p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-muted">Pets vinculados</p><strong className="mt-2 block text-2xl text-text">{clients.length}</strong></div>
          </div>

          {loading ? <p className="py-10 text-center text-sm text-muted">Carregando histórico...</p> : error ? (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-muted">Nenhuma compra ou atendimento encontrado.</p>
          ) : (
            <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => {
                const Icon = row.kind === 'purchase' ? ShoppingBag : Scissors
                return (
                  <article key={row.id} className="rounded-xl border border-[var(--border)] bg-card px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-emerald-500/10 p-2 text-emerald-400"><Icon size={15}/></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-text">{row.title}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><CalendarClock size={12}/> {fmtDateTime(row.date)} · {row.pet}</p>
                          </div>
                          <div className="text-right"><span className="badge badge-gray">{row.status}</span><p className="mt-1 font-bold text-emerald-400">{fmtMoney(row.value)}</p></div>
                        </div>
                        {row.delivery && <p className="mt-2 flex items-start gap-1 text-xs text-sky-300"><Truck size={12} className="mt-0.5 shrink-0"/> {row.delivery}</p>}
                        {row.instructions && <p className="mt-2 whitespace-pre-wrap rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-100"><strong>Instruções do atendimento:</strong> {row.instructions}</p>}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function MachineModal({ selected, saving, error, onSelect, onConfirm, onClose }) {
  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => !saving && event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-md">
        <div className="modal-header">
          <div><h2 className="font-display text-xl font-bold text-text">Concluir tosa</h2><p className="mt-1 text-sm text-muted">Nº da máquina utilizada — preenchimento opcional.</p></div>
          <button type="button" aria-label="Fechar máquina" disabled={saving} onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {GROOMING_MACHINE_OPTIONS.map((machine) => (
              <button key={machine} type="button" onClick={() => onSelect(machine)} className={`rounded-xl border px-3 py-4 text-center text-lg font-black ${selected === machine ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border)] text-text hover:border-emerald-500/35'}`}>{machine}</button>
            ))}
            <button type="button" onClick={() => onSelect(null)} className={`rounded-xl border px-2 py-4 text-center text-xs font-bold ${selected === null ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-[var(--border)] text-muted hover:border-emerald-500/35'}`}>Sem Nº</button>
          </div>
          <p className="text-xs text-muted">O histórico ficará como “Tosa ... - Nº 7”. Sem seleção, o atendimento será concluído normalmente.</p>
          {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
          <div className="flex gap-2"><button type="button" disabled={saving} className="btn btn-secondary flex-1 justify-center" onClick={onClose}>Cancelar</button><button type="button" disabled={saving} className="btn btn-primary flex-1 justify-center" onClick={onConfirm}>{saving ? 'Salvando...' : 'Concluir atendimento'}</button></div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ClientHistoryGroomingEnhancer() {
  const { activeTenantId } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const [clients, setClients] = useState([])
  const [historyGroup, setHistoryGroup] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [machinePrompt, setMachinePrompt] = useState(null)
  const [machineNo, setMachineNo] = useState(null)
  const [machineSaving, setMachineSaving] = useState(false)
  const [machineError, setMachineError] = useState('')

  const groups = useMemo(() => groupClients(clients), [clients])

  const loadClients = useCallback(async () => {
    if (!activeTenantId || activeModuleId !== 'petshop') return []
    const response = await tenantQuery(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('clients')
        .select('id,name,document,phone,details')
        .eq('module_id', activeModuleId)
        .eq('active', true)
      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })
    if (response.error) throw response.error
    const mappedClients = (response.data || []).map(mapClient)
    setClients(mappedClients)
    return mappedClients
  }, [activeModuleId, activeTenantId])

  useEffect(() => {
    if (!activeTenantId || activeModuleId !== 'petshop') return undefined
    let cancelled = false
    loadClients().catch((error) => {
      if (!cancelled) console.warn('Falha ao carregar clientes para histórico:', error?.message || error)
    })
    return () => { cancelled = true }
  }, [activeModuleId, activeTenantId, loadClients])

  const openHistory = useCallback(async (group) => {
    setHistoryGroup(group)
    setHistoryRows([])
    setHistoryError('')
    setHistoryLoading(true)
    try {
      setHistoryRows(await loadHistory(activeModuleId, activeTenantId, group))
    } catch (error) {
      setHistoryError(error?.message || 'Não foi possível carregar o histórico.')
    } finally {
      setHistoryLoading(false)
    }
  }, [activeModuleId, activeTenantId])

  useEffect(() => {
    const onHistoryClick = (event) => {
      const button = event.target.closest?.('[data-yuisync-client-history]')
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      const groupKey = button.dataset.yuisyncClientHistory

      void (async () => {
        let group = groups.get(groupKey)
        if (!group) {
          try {
            group = groupClients(await loadClients()).get(groupKey)
          } catch (error) {
            setHistoryGroup({ key: groupKey, owner_name: 'Cliente', clients: [] })
            setHistoryRows([])
            setHistoryError(error?.message || 'Não foi possível carregar os clientes para abrir o histórico.')
            setHistoryLoading(false)
            return
          }
        }

        if (!group) {
          setHistoryGroup({ key: groupKey, owner_name: 'Cliente', clients: [] })
          setHistoryRows([])
          setHistoryError('Não foi possível identificar este tutor. Atualize a página e tente novamente.')
          setHistoryLoading(false)
          return
        }

        void openHistory(group)
      })()
    }

    const onCompleteCapture = (event) => {
      const action = event.target.closest?.('[data-yuisync-action="complete"]')
      if (!action) return
      if (action.dataset.yuisyncMachineBypass === 'true') {
        delete action.dataset.yuisyncMachineBypass
        return
      }
      const card = action.closest('[data-yuisync-appointment-id]')
      if (!card || card.dataset.yuisyncRequiresMachineNumber !== 'true') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setMachineNo(null)
      setMachineError('')
      setMachinePrompt({ appointmentId: card.dataset.yuisyncAppointmentId, action })
    }

    document.addEventListener('click', onHistoryClick, true)
    document.addEventListener('click', onCompleteCapture, true)
    return () => {
      document.removeEventListener('click', onHistoryClick, true)
      document.removeEventListener('click', onCompleteCapture, true)
    }
  }, [groups, loadClients, openHistory])

  const confirmMachine = useCallback(async () => {
    if (!machinePrompt?.appointmentId) return
    setMachineSaving(true)
    setMachineError('')
    try {
      const response = await tenantQuery(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('appointments')
          .update({ grooming_machine_no: machineNo, updated_at: new Date().toISOString() })
          .eq('id', machinePrompt.appointmentId)
          .eq('module_id', activeModuleId)
        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })
      if (response.error) throw response.error
      const action = machinePrompt.action
      setMachinePrompt(null)
      if (action?.isConnected) {
        action.dataset.yuisyncMachineBypass = 'true'
        action.click()
      }
    } catch (error) {
      setMachineError(error?.message || 'Não foi possível salvar o Nº da máquina.')
    } finally {
      setMachineSaving(false)
    }
  }, [activeModuleId, activeTenantId, machineNo, machinePrompt])

  return (
    <>
      {historyGroup && <HistoryModal group={historyGroup} rows={historyRows} loading={historyLoading} error={historyError} onClose={() => setHistoryGroup(null)} />}
      {machinePrompt && <MachineModal selected={machineNo} saving={machineSaving} error={machineError} onSelect={setMachineNo} onConfirm={confirmMachine} onClose={() => !machineSaving && setMachinePrompt(null)} />}
    </>
  )
}

export default ClientHistoryGroomingEnhancer
