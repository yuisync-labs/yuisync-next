import { getAuthSession, signInWithPassword, signOutSession } from './authApi'
import { isVisualPreviewSession } from './visualPreview'
import { runVisualPreviewQuery, runVisualPreviewRpc } from './visualPreviewData'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const ACTIVE_TENANT_KEY = '@yui_active_tenant'
const ACTIVE_MODULE_KEY = '@app_module'

const OPERATION_ERROR_MESSAGES = Object.freeze({
  SERVICE_REQUIRED: 'Selecione pelo menos um serviço para o agendamento.',
  SERVICE_NOT_FOUND: 'Um dos serviços selecionados não está mais disponível. Atualize a agenda e tente novamente.',
  MIXED_SERVICE_GROUPS: 'Não é possível combinar serviços de áreas diferentes no mesmo agendamento.',
  SERVICE_SPECIES_MISMATCH: 'Este serviço não está configurado para a espécie do pet selecionado.',
  SERVICE_WEIGHT_MISMATCH: 'Este serviço não atende à faixa de peso cadastrada para o pet selecionado.',
  PET_NOT_FOUND: 'O pet selecionado não foi encontrado ou não está ativo.',
  PET_CLIENT_MISMATCH: 'O pet selecionado não pertence ao cliente informado.',
  IDEMPOTENCY_KEY_REUSED: 'Esta tentativa de salvar já foi usada com outros dados. Atualize a agenda e tente novamente.',
  APPOINTMENT_ID_CONFLICT: 'O identificador deste agendamento já pertence a outra operação. Atualize a agenda e tente novamente.',
  APPOINTMENT_REOPEN_EDIT_SEPARATELY: 'Reabra o atendimento primeiro. Depois altere o pet ou os serviços em uma nova edição.',
  APPOINTMENT_REOPEN_REFUND_REQUIRED: 'Este atendimento possui pagamento recebido. Faça o estorno financeiro antes de reabri-lo.',
  APPOINTMENT_REOPEN_SALE_CANCEL_REQUIRED: 'Este atendimento possui uma venda ativa. Cancele a venda antes de reabri-lo.',
  APPOINTMENT_REOPEN_CONCURRENT_CHANGE: 'O atendimento mudou enquanto era reaberto. Atualize a agenda e tente novamente.',
  APPOINTMENT_REOPEN_FAILED: 'Não foi possível reabrir o atendimento. Atualize a agenda e tente novamente.',
  APPOINTMENT_COMPLETION_PACKAGE_RECONCILIATION_UNAVAILABLE: 'O atendimento foi concluído, mas o pacote ainda não foi atualizado. Tente concluir novamente; a repetição é segura.',
  APPOINTMENT_COMPLETION_PACKAGE_RECONCILIATION_FAILED: 'O atendimento foi concluído, mas a atualização do pacote não terminou. Tente concluir novamente; a repetição é segura.',
  APPOINTMENT_SNAPSHOT_FAILED: 'O atendimento foi salvo, mas não foi possível confirmar o snapshot operacional. Atualize a agenda antes de continuar.',
})

export function compatOperationErrorMessage(payload = {}) {
  const explicitMessage = payload?.message || payload?.error?.message
  if (explicitMessage) return String(explicitMessage)

  const code = String(payload?.code || payload?.error?.code || '').trim()
  if (code && OPERATION_ERROR_MESSAGES[code]) return OPERATION_ERROR_MESSAGES[code]
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim()
  return code || 'Falha na operação de dados.'
}

function asError(payload, status) {
  const error = new Error(compatOperationErrorMessage(payload))
  error.code = payload?.code || payload?.error?.code || ''
  error.status = status
  error.details = payload?.details || null
  error.hint = payload?.hint || null
  return error
}

function safeStorageGet(key) {
  try { return globalThis?.localStorage?.getItem(key) || null } catch { return null }
}

function activeModuleFromLocation() {
  try {
    const first = globalThis?.location?.pathname?.split('/').filter(Boolean)?.[0]
    return first || null
  } catch {
    return null
  }
}

function eqFilterValue(body, column) {
  const filters = Array.isArray(body?.filters) ? body.filters : []
  const match = filters.find((filter) => filter?.op === 'eq' && filter?.column === column)
  return match?.value == null ? null : String(match.value).trim()
}

function payloadScopeValue(body, column) {
  const payload = body?.payload
  const row = Array.isArray(payload) ? payload[0] : payload
  return row && typeof row === 'object' && row[column] != null ? String(row[column]).trim() : null
}

function compatibilityScopeHeaders(body) {
  if (!body || typeof body !== 'object') return {}
  const tenantId = eqFilterValue(body, 'tenant_id') || payloadScopeValue(body, 'tenant_id') || safeStorageGet(ACTIVE_TENANT_KEY)
  const moduleId = eqFilterValue(body, 'module_id') || payloadScopeValue(body, 'module_id') || safeStorageGet(ACTIVE_MODULE_KEY) || activeModuleFromLocation()
  const headers = {}
  if (tenantId) headers['x-tenant-id'] = tenantId
  if (moduleId) headers['x-module-id'] = moduleId
  return headers
}

async function request(path, options = {}) {
  let parsedBody = null
  if (typeof options.body === 'string') {
    try { parsedBody = JSON.parse(options.body) } catch { parsedBody = null }
  }

  if (isVisualPreviewSession()) {
    if (path === '/compat/query') return runVisualPreviewQuery(parsedBody)
    if (path === '/compat/rpc') return runVisualPreviewRpc(parsedBody)
    return {
      data: null,
      error: asError({
        code: 'VISUAL_PREVIEW_READ_ONLY',
        message: 'O modo visual local não salva alterações.',
      }, 409),
      count: null,
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...compatibilityScopeHeaders(parsedBody),
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) return { data: null, error: asError(payload, response.status), count: payload?.count ?? null }
  return { data: payload?.data ?? null, error: null, count: payload?.count ?? null }
}

export function compatMutationReturningFilters(action, payload, filters = [], returning = false) {
  const next = Array.isArray(filters) ? [...filters] : []
  if (!returning || action === 'select' || next.some((filter) => filter?.column === 'id')) return next

  const rows = (Array.isArray(payload) ? payload : [payload]).filter((row) => row && typeof row === 'object')
  const ids = [...new Set(rows.map((row) => String(row.id || '').trim()).filter(Boolean))]
  if (ids.length === 1) next.push({ op: 'eq', column: 'id', value: ids[0] })
  else if (ids.length > 1) next.push({ op: 'in', column: 'id', value: ids })
  return next
}

class EdgeQueryBuilder {
  constructor(table) {
    this.table = table
    this.action = 'select'
    this.columns = '*'
    this.payload = null
    this.filters = []
    this.orders = []
    this.limitValue = null
    this.rangeValue = null
    this.mode = 'many'
    this.conflict = null
    this.returning = false
  }

  select(columns = '*', options = {}) {
    if (this.action !== 'select') this.returning = true
    this.columns = String(columns || '*')
    if (options?.count) this.countMode = options.count
    return this
  }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this }
  update(payload) { this.action = 'update'; this.payload = payload; return this }
  upsert(payload, options = {}) { this.action = 'upsert'; this.payload = payload; this.conflict = options.onConflict || null; return this }
  delete() { this.action = 'delete'; return this }
  eq(column, value) { this.filters.push({ op: 'eq', column, value }); return this }
  neq(column, value) { this.filters.push({ op: 'neq', column, value }); return this }
  gt(column, value) { this.filters.push({ op: 'gt', column, value }); return this }
  gte(column, value) { this.filters.push({ op: 'gte', column, value }); return this }
  lt(column, value) { this.filters.push({ op: 'lt', column, value }); return this }
  lte(column, value) { this.filters.push({ op: 'lte', column, value }); return this }
  in(column, values) { this.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] }); return this }
  is(column, value) { this.filters.push({ op: 'is', column, value }); return this }
  ilike(column, value) { this.filters.push({ op: 'ilike', column, value }); return this }
  contains(column, value) { this.filters.push({ op: 'contains', column, value }); return this }
  not(column, operator, value) { this.filters.push({ op: 'not', column, operator, value }); return this }
  or(expression) { this.filters.push({ op: 'or', expression: String(expression || '') }); return this }
  order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false, nullsFirst: options.nullsFirst === true }); return this }
  limit(value) { this.limitValue = Math.max(0, Number(value || 0)); return this }
  range(from, to) { this.rangeValue = { from: Math.max(0, Number(from || 0)), to: Math.max(0, Number(to || 0)) }; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybeSingle'; return this }

  async execute() {
    const scopedFilters = compatMutationReturningFilters(this.action, this.payload, this.filters, this.returning)
    return request('/compat/query', {
      method: 'POST',
      body: JSON.stringify({
        table: this.table,
        action: this.action,
        columns: this.columns,
        payload: this.payload,
        filters: scopedFilters,
        orders: this.orders,
        limit: this.limitValue,
        range: this.rangeValue,
        mode: this.mode,
        conflict: this.conflict,
        returning: this.returning,
        count: this.countMode || null,
      }),
    })
  }

  then(resolve, reject) { return this.execute().then(resolve, reject) }
  catch(reject) { return this.execute().catch(reject) }
  finally(callback) { return this.execute().finally(callback) }
}

function realtimeScope() {
  const tenantId = safeStorageGet(ACTIVE_TENANT_KEY)
  const moduleId = safeStorageGet(ACTIVE_MODULE_KEY) || activeModuleFromLocation()
  if (!tenantId || !moduleId) return null
  return { tenantId, moduleId }
}

function realtimeUrl() {
  const scope = realtimeScope()
  if (!scope) return null
  try {
    const origin = globalThis?.location?.origin || 'http://localhost'
    const url = new URL(`${API_BASE}/realtime`, origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('tenant_id', scope.tenantId)
    url.searchParams.set('module_id', scope.moduleId)
    return url.toString()
  } catch {
    return null
  }
}

class EdgeRealtimeChannel {
  constructor(name) {
    this.name = name
    this.callbacks = []
    this.socket = null
    this.statusCallback = null
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.closed = false
  }

  on(type, filter, callback) {
    if (typeof callback === 'function') this.callbacks.push({ type, filter, callback })
    return this
  }

  notify(status) {
    if (typeof this.statusCallback === 'function') {
      try { this.statusCallback(status) } catch { /* subscriber status handlers are isolated */ }
    }
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return
    const delay = Math.min(15000, 500 * (2 ** Math.min(this.reconnectAttempt, 5)))
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  connect() {
    if (this.closed || this.socket) return
    if (isVisualPreviewSession()) {
      this.notify('SUBSCRIBED')
      return
    }
    const url = realtimeUrl()
    if (!url || typeof globalThis?.WebSocket !== 'function') {
      this.notify('CHANNEL_ERROR')
      this.scheduleReconnect()
      return
    }

    let socket
    try {
      socket = new globalThis.WebSocket(url)
    } catch {
      this.notify('CHANNEL_ERROR')
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempt = 0
    }

    socket.onmessage = (event) => {
      if (event.data === 'pong') return
      let payload
      try { payload = JSON.parse(String(event.data || '')) } catch { return }
      if (payload?.type === 'realtime.system' && payload?.event === 'SUBSCRIBED') {
        this.notify('SUBSCRIBED')
        return
      }
      if (payload?.type !== 'realtime.invalidate') return

      const compatPayload = {
        eventType: payload.eventType || 'SYNC',
        schema: payload.schema || 'edge',
        table: payload.table ?? null,
        new: null,
        old: null,
        eventId: payload.eventId || null,
        source: payload.source || null,
        occurredAtMs: payload.occurredAtMs || null,
      }
      for (const subscription of this.callbacks) {
        try { subscription.callback(compatPayload) } catch { /* one listener must not break the channel */ }
      }
    }

    socket.onerror = () => {
      this.notify('CHANNEL_ERROR')
    }

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      if (this.closed) return
      this.notify('CLOSED')
      this.scheduleReconnect()
    }
  }

  subscribe(callback) {
    this.statusCallback = typeof callback === 'function' ? callback : null
    this.closed = false
    this.connect()
    return this
  }

  unsubscribe() {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      try { socket.close(1000, 'client_unsubscribe') } catch { /* already closed */ }
    }
    this.notify('CLOSED')
    return Promise.resolve('ok')
  }
}

export const supabase = {
  from(table) { return new EdgeQueryBuilder(table) },
  rpc(name, args = {}) {
    return request('/compat/rpc', { method: 'POST', body: JSON.stringify({ name, args }) })
  },
  auth: {
    async getSession() {
      try { const session = await getAuthSession(); return { data: { session }, error: null } }
      catch (error) { return { data: { session: null }, error } }
    },
    async getUser() {
      try { const session = await getAuthSession(); return { data: { user: session?.user || null }, error: null } }
      catch (error) { return { data: { user: null }, error } }
    },
    signInWithPassword({ email, password }) { return signInWithPassword(email, password) },
    async signOut() { try { await signOutSession(); return { error: null } } catch (error) { return { error } } },
    onAuthStateChange(callback) {
      let cancelled = false
      getAuthSession().then((session) => { if (!cancelled && typeof callback === 'function') callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session) }).catch(() => {})
      return { data: { subscription: { unsubscribe() { cancelled = true } } } }
    },
  },
  channel(name) { return new EdgeRealtimeChannel(name) },
  removeChannel(channel) { return channel?.unsubscribe?.() || Promise.resolve('ok') },
}

export const getLocalISO = (date = new Date()) => {
  const d = new Date(date)
  const z = d.getTimezoneOffset() * 60 * 1000
  const local = new Date(d.getTime() - z)
  return local.toISOString().split('T')[0]
}

export const todayISO = () => getLocalISO()

export const getTimezoneOffset = () => {
  const offset = new Date().getTimezoneOffset()
  const absOffset = Math.abs(offset)
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0')
  const minutes = String(absOffset % 60).padStart(2, '0')
  return (offset <= 0 ? '+' : '-') + hours + ':' + minutes
}

export const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
}

export const fmtDateTime = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
}

export const fmtTime = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
}

export const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v ?? 0)