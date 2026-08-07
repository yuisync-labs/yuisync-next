import { getAuthSession, signInWithPassword, signOutSession } from './authApi'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

function asError(payload, status) {
  const error = new Error(payload?.message || payload?.error?.message || payload?.error || payload?.code || 'Falha na operacao de dados.')
  error.code = payload?.code || payload?.error?.code || ''
  error.status = status
  error.details = payload?.details || null
  error.hint = payload?.hint || null
  return error
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) return { data: null, error: asError(payload, response.status), count: payload?.count ?? null }
  return { data: payload?.data ?? null, error: null, count: payload?.count ?? null }
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
    return request('/compat/query', {
      method: 'POST',
      body: JSON.stringify({
        table: this.table,
        action: this.action,
        columns: this.columns,
        payload: this.payload,
        filters: this.filters,
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

class EdgeRealtimeChannel {
  constructor(name) { this.name = name; this.callbacks = []; this.timer = null }
  on(_type, _filter, callback) { if (typeof callback === 'function') this.callbacks.push(callback); return this }
  subscribe(callback) {
    if (typeof callback === 'function') queueMicrotask(() => callback('SUBSCRIBED'))
    this.timer = setInterval(() => {
      this.callbacks.forEach((handler) => handler({ eventType: 'SYNC', schema: 'edge', table: null, new: null, old: null }))
    }, 5000)
    return this
  }
  unsubscribe() { if (this.timer) clearInterval(this.timer); this.timer = null; return Promise.resolve('ok') }
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
