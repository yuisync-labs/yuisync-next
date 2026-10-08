import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { requestChatReply, sendHumanChatMessage } from '../../lib/api'
import { useModuleCtx } from '../../context/ModuleContext'
import { useAuthCtx } from '../../context/AuthContext'
import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../lib/tenant'

function createPendingClientMessage(content) {
  const id = crypto.randomUUID()
  return {
    id,
    role: 'user',
    content,
    metadata: { pending: true, local_only: true, client_message_id: id },
    sent_at: new Date().toISOString(),
    dashboard_turn_version: null,
  }
}

function effectiveTurnVersion(message = {}) {
  const version = Number(message.dashboard_turn_version ?? message.metadata?.dashboard_turn_version ?? 0)
  return Number.isInteger(version) && version > 0 ? version : 0
}

function normalizeIncomingMessage(message) {
  return {
    ...message,
    sent_at: message.sent_at || null,
    dashboard_turn_version: effectiveTurnVersion(message) || null,
  }
}

const CHAT_ROLE_ORDER = { user: 0, assistant: 1, human_agent: 1, system: 2 }

export function sortChatMessages(messages) {
  return [...messages].sort((left, right) => {
    const leftVersion = effectiveTurnVersion(left)
    const rightVersion = effectiveTurnVersion(right)
    if (leftVersion > 0 && rightVersion > 0) {
      if (leftVersion !== rightVersion) return leftVersion - rightVersion
      const roleDiff = (CHAT_ROLE_ORDER[left?.role] ?? 9) - (CHAT_ROLE_ORDER[right?.role] ?? 9)
      if (roleDiff !== 0) return roleDiff
    }

    const leftTime = new Date(left?.sent_at || 0).getTime()
    const rightTime = new Date(right?.sent_at || 0).getTime()
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }

    if (leftVersion !== rightVersion) {
      if (!leftVersion) return -1
      if (!rightVersion) return 1
      return leftVersion - rightVersion
    }

    const leftPending = left?.metadata?.local_only === true
    const rightPending = right?.metadata?.local_only === true
    if (leftPending !== rightPending) return leftPending ? 1 : -1

    return String(left?.id || '').localeCompare(String(right?.id || ''))
  })
}

function isMatchingPendingMessage(localMessage, incomingMessage) {
  if (!localMessage?.metadata?.local_only) return false
  if (localMessage.metadata.failed) return false
  if (localMessage.role !== incomingMessage.role) return false
  if (incomingMessage?.metadata?.client_message_id && localMessage.metadata.client_message_id === incomingMessage.metadata.client_message_id) {
    return true
  }
  if (String(localMessage.content || '') !== String(incomingMessage.content || '')) return false

  const localTime = new Date(localMessage.sent_at || 0).getTime()
  const incomingTime = new Date(incomingMessage.sent_at || 0).getTime()
  if (!Number.isFinite(localTime) || !Number.isFinite(incomingTime)) return true

  return Math.abs(incomingTime - localTime) < 120000
}

function mergeIncomingMessage(previousMessages, message) {
  const incomingMessage = normalizeIncomingMessage(message)
  const existingIndex = previousMessages.findIndex((item) => item.id === incomingMessage.id)
  if (existingIndex >= 0) {
    const existing = previousMessages[existingIndex]
    if (!existing?.metadata?.local_only && JSON.stringify(existing) === JSON.stringify(incomingMessage)) {
      return previousMessages
    }
    const next = [...previousMessages]
    next[existingIndex] = incomingMessage
    return sortChatMessages(next)
  }

  const pendingIndex = previousMessages.findIndex((item) => isMatchingPendingMessage(item, incomingMessage))
  if (pendingIndex >= 0) {
    const next = [...previousMessages]
    next[pendingIndex] = incomingMessage
    return sortChatMessages(next)
  }

  return sortChatMessages([...previousMessages, incomingMessage])
}

function playHandoffSound() {
  if (typeof window === 'undefined') return
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    gain.gain.setValueAtTime(0.001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.24)
    setTimeout(() => context.close?.(), 400)
  } catch {
    // Audio can be blocked by the browser until the first user interaction.
  }
}

function normalizeHandoffTarget({ guard = {}, state = {}, reason = '' } = {}) {
  const rawTarget = String(guard.handoff_target || guard.handoffTarget || state.handoffTarget || '').toLowerCase()
  const reasonText = String(reason || '').toLowerCase()
  const intent = String(guard.intent || state.intent || '').toLowerCase()
  if (rawTarget === 'veterinaria' || reasonText.includes('veterinaria') || intent === 'veterinaria') return 'veterinaria'
  return 'atendente'
}

function handoffAlertFromMessage(message, session = {}) {
  const metadata = message?.metadata || {}
  const guard = metadata.petbot_guard || {}
  const state = metadata.petbot_state || {}
  if (!guard.needs_human && !guard.needs_handoff) return null
  const reasons = Array.isArray(guard.blocked_reasons) ? guard.blocked_reasons : []
  const reason = reasons[0] || guard.action || 'handoff'
  const target = normalizeHandoffTarget({ guard, state, reason })
  return {
    id: `msg:${message.id}`,
    messageId: message.id,
    sessionId: message.session_id || session.id,
    customerName: session.customer_name || session.customer_phone || 'Cliente',
    target,
    reason,
    content: message.content || '',
    createdAt: message.sent_at || new Date().toISOString(),
  }
}

function handoffAlertFromSession(session = {}) {
  const state = session?.context?.petbot || {}
  const reasons = Array.isArray(state.blockedReasons) ? state.blockedReasons : []
  const isHandoff = session.status === 'human' && (state.status === 'human_requested' || state.awaiting === 'human' || reasons.length > 0)
  if (!isHandoff) return null
  const reason = reasons[0] || state.lastAction || 'handoff'
  const target = normalizeHandoffTarget({ state, reason })
  return {
    id: `session:${session.id}:${session.last_message_at || ''}:${reason}`,
    sessionId: session.id,
    customerName: session.customer_name || session.customer_phone || 'Cliente',
    target,
    reason,
    content: '',
    createdAt: session.last_message_at || new Date().toISOString(),
  }
}

export function useChat() {
  const [sessions, setSessions] = useState([])
  const [messages, setMessages] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [botTyping, setBotTyping] = useState(false)
  const [quickReplies, setQuickReplies] = useState([])
  const [handoffAlerts, setHandoffAlerts] = useState([])
  const channelRef = useRef(null)
  const msgChannelRef = useRef(null)
  const activeSessionIdRef = useRef(null)
  const handoffAlertIdsRef = useRef(new Set())
  const botRequestsInFlightRef = useRef(0)
  const { activeModuleId } = useModuleCtx()
  const { activeTenantId } = useAuthCtx()

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id || null
  }, [activeSession?.id])

  const pushHandoffAlert = useCallback((source, session) => {
    const alert = source?.metadata
      ? handoffAlertFromMessage(source, session)
      : handoffAlertFromSession(source)
    if (!alert?.sessionId || handoffAlertIdsRef.current.has(alert.id)) return

    handoffAlertIdsRef.current.add(alert.id)
    setHandoffAlerts((prev) => [alert, ...prev].slice(0, 5))
    playHandoffSound()
  }, [])

  const dismissHandoffAlert = useCallback((alertId) => {
    setHandoffAlerts((prev) => prev.filter((alert) => alert.id !== alertId))
  }, [])

  const loadSessions = useCallback(async (statusFilter = '') => {
    if (!activeModuleId) return
    setLoading(true)

    try {
      const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('chat_sessions')
          .select('id, customer_phone, customer_name, status, intent, last_message_at, opened_at, csat_score, clients(name, details)')
          .eq('module_id', activeModuleId)
          .order('last_message_at', { ascending: false })

        query = applyTenantFilter(query, activeTenantId, includeTenant)
        if (statusFilter) query = query.eq('status', statusFilter)
        return query
      })

      if (response.error) throw response.error

      const mapped = (response.data || []).map((session) => {
        if (!session.clients) return session
        return {
          ...session,
          pets: {
            pet_name: session.clients.details?.pet_name || session.clients.name || '',
            species: session.clients.details?.species || '',
          },
          clients: undefined,
        }
      })

      setSessions(mapped)
    } finally {
      setLoading(false)
    }
  }, [activeModuleId, activeTenantId])

  const loadMessages = useCallback(async (sessionId) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('id, role, content, metadata, tokens_used, sent_at, dashboard_turn_version')
      .eq('session_id', sessionId)
      .order('sent_at', { ascending: true })
      .order('id', { ascending: true })

    const normalized = sortChatMessages((data || []).map(normalizeIncomingMessage))

    setMessages(normalized)
    return normalized
  }, [])

  const openSession = useCallback(async (session) => {
    setActiveSession(session)
    activeSessionIdRef.current = session.id
    const loadedMessages = await loadMessages(session.id)

    msgChannelRef.current?.unsubscribe()
    msgChannelRef.current = supabase
      .channel(`messages-${session.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setMessages((prev) => prev.filter((message) => message.id !== payload.old?.id))
          return
        }
        if (!payload.new?.id) return
        pushHandoffAlert(payload.new, session)
        setMessages((prev) => mergeIncomingMessage(prev, payload.new))
      })
      .subscribe()

    return loadedMessages
  }, [loadMessages, pushHandoffAlert])

  const createSession = useCallback(async ({ customer_phone, customer_name, pet_id, channel = 'whatsapp' }) => {
    if (!activeModuleId) throw new Error('Modulo nao definido')

    // The D1 compatibility endpoint re-selects rows after an insert.
    // Without an ID filter, .single() fails when the tenant already has chats,
    // even if the insert succeeded. Reuse this ID across scoped retries.
    const sessionId = crypto.randomUUID()
    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      const payload = buildTenantPayload({
        id: sessionId,
        customer_phone,
        customer_name,
        client_id: pet_id,
        channel,
        status: 'bot',
        module_id: activeModuleId,
      }, activeTenantId, includeTenant)

      return supabase
        .from('chat_sessions')
        .insert(payload)
        .eq('id', sessionId)
        .select()
        .single()
    })

    if (response.error) throw response.error
    setSessions((prev) => [response.data, ...prev])
    return response.data
  }, [activeModuleId, activeTenantId])

  const sendClientMessage = useCallback(async (sessionId, text) => {
    const trimmed = String(text || '').trim()
    if (!trimmed) return

    const optimisticMessage = createPendingClientMessage(trimmed)
    setMessages((prev) => sortChatMessages([...prev, optimisticMessage]))
    botRequestsInFlightRef.current += 1
    setBotTyping(true)

    try {
      const result = await requestChatReply(sessionId, trimmed, {
        clientMessageId: optimisticMessage.id,
        tenantId: activeTenantId,
        moduleId: activeModuleId,
      })

      const persistedMessage = (result?.savedUserMessages || []).find((message) => (
        message?.id === optimisticMessage.id
        || message?.metadata?.client_message_id === optimisticMessage.id
      ))

      if (persistedMessage) {
        setMessages((prev) => mergeIncomingMessage(prev, persistedMessage))
      }

      if (activeSessionIdRef.current === sessionId) {
        await loadMessages(sessionId)
      }

      return result
    } catch (error) {
      setMessages((prev) => prev.map((message) => (
        message.id === optimisticMessage.id
          ? { ...message, metadata: { ...(message.metadata || {}), pending: false, failed: true } }
          : message
      )))
      console.error('Falha na ingestão serverless do chat:', error)
      throw error
    } finally {
      botRequestsInFlightRef.current = Math.max(0, botRequestsInFlightRef.current - 1)
      if (botRequestsInFlightRef.current === 0) setBotTyping(false)
    }
  }, [loadMessages, activeTenantId, activeModuleId])

  const sendHumanMessage = useCallback(async (sessionId, text) => {
    const trimmed = String(text || '').trim()
    if (!trimmed) return

    await sendHumanChatMessage(sessionId, trimmed)
    await loadMessages(sessionId)
  }, [loadMessages])

  const takeOver = useCallback(async (sessionId, employeeId) => {
    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('chat_sessions')
        .update({ status: 'human', employee_id: employeeId })
        .eq('id', sessionId)
        .select()
        .single()

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    if (response.error) throw response.error
    setActiveSession(response.data)
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, status: 'human' } : session)))
    return response.data
  }, [activeTenantId])

  const returnToBot = useCallback(async (sessionId) => {
    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('chat_sessions')
        .update({ status: 'bot', employee_id: null })
        .eq('id', sessionId)
        .select()
        .single()

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    if (response.error) throw response.error
    setActiveSession(response.data)
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, status: 'bot' } : session)))
  }, [activeTenantId])

  const closeSession = useCallback(async (sessionId, csatScore) => {
    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('chat_sessions')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          ...(csatScore !== undefined && csatScore !== null ? { csat_score: csatScore } : {}),
        })
        .eq('id', sessionId)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    if (response.error) throw response.error
    setSessions((prev) => prev.filter((session) => session.id !== sessionId))
    if (activeSession?.id === sessionId) setActiveSession(null)
  }, [activeSession?.id, activeTenantId])

  const subscribeSessionsList = useCallback(() => {
    if (!activeModuleId) return

    channelRef.current?.unsubscribe()
    channelRef.current = supabase
      .channel('chat-sessions-list')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_sessions',
        filter: `module_id=eq.${activeModuleId}`,
      }, (payload) => {
        if (payload?.new) pushHandoffAlert(payload.new)
        loadSessions()
      })
      .subscribe()
  }, [activeModuleId, loadSessions, pushHandoffAlert])

  const loadQuickReplies = useCallback(async () => {
    const { data } = await supabase
      .from('quick_replies')
      .select('id, category, title, text')
      .eq('active', true)
      .order('category')

    setQuickReplies(data || [])
  }, [])

  useEffect(() => () => {
    channelRef.current?.unsubscribe()
    msgChannelRef.current?.unsubscribe()
    activeSessionIdRef.current = null
  }, [])

  const statusConfig = (status) => ({
    bot: { cls: 'badge-amber', label: 'Bot', dot: 'bg-amber-400' },
    human: { cls: 'badge-purple', label: 'Atendente', dot: 'bg-violet-400' },
    waiting: { cls: 'badge-blue', label: 'Aguardando', dot: 'bg-blue-400' },
    closed: { cls: 'badge-gray', label: 'Fechado', dot: 'bg-gray-500' },
  }[status] || { cls: 'badge-gray', label: status, dot: 'bg-gray-500' })

  return {
    sessions,
    messages,
    activeSession,
    loading,
    botTyping,
    quickReplies,
    handoffAlerts,
    loadSessions,
    loadMessages,
    loadQuickReplies,
    openSession,
    createSession,
    sendClientMessage,
    sendHumanMessage,
    takeOver,
    returnToBot,
    closeSession,
    subscribeSessionsList,
    setActiveSession,
    statusConfig,
    dismissHandoffAlert,
  }
}
