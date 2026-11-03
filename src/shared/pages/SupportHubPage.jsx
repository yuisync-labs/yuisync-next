import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Clock3, MessageSquare, RefreshCw, Send, ShieldAlert, User2, XCircle,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthCtx } from '../../context/AuthContext'
import { useModuleCtx } from '../../context/ModuleContext'

const THREAD_STATUSES = ['pending', 'open', 'finalized', 'closed']

function isSupportSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false
  return (
    (message.includes('support_threads') || message.includes('support_messages'))
    && (message.includes('does not exist') || message.includes('schema cache') || message.includes('relation'))
  )
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusBadge(status) {
  if (status === 'open') return 'badge-green'
  if (status === 'pending') return 'badge-amber'
  if (status === 'finalized') return 'badge-gray'
  return 'badge-gray'
}

export default function SupportHubPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuthCtx()
  const { activeModule } = useModuleCtx()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [threads, setThreads] = useState([])
  const [selectedThreadId, setSelectedThreadId] = useState('')
  const [messages, setMessages] = useState([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState('')
  const [profilesById, setProfilesById] = useState({})
  const [tenantsById, setTenantsById] = useState({})
  const [claimingThreadId, setClaimingThreadId] = useState('')

  const isGlobalAdmin = profile?.role === 'admin'
  const selectedThread = useMemo(() => threads.find((item) => item.id === selectedThreadId) || null, [threads, selectedThreadId])
  const pendingNotifications = useMemo(
    () => threads.filter((thread) => !thread.assigned_to && (thread.status === 'pending' || thread.status === 'open')),
    [threads],
  )
  const shouldAutoClaimFromHubAlert = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('auto_claim') === '1'
  }, [location.search])

  const loadThreads = useCallback(async () => {
    if (!isGlobalAdmin) return
    setLoading(true)
    setError('')
    try {
      const { data, error: threadError } = await supabase
        .from('support_threads')
        .select('id,tenant_id,module_id,requester_profile_id,assigned_to,status,priority,subject,last_message_preview,last_message_at,created_at')
        .order('last_message_at', { ascending: false })
        .limit(400)

      if (threadError) throw threadError

      setSchemaMissing(false)
      const nextThreads = data || []
      setThreads(nextThreads)
      if (!selectedThreadId && nextThreads.length > 0) {
        setSelectedThreadId(nextThreads[0].id)
      }

      const profileIds = [...new Set(nextThreads.flatMap((thread) => [thread.requester_profile_id, thread.assigned_to]).filter(Boolean))]
      const tenantIds = [...new Set(nextThreads.map((thread) => thread.tenant_id).filter(Boolean))]

      const [profilesResponse, tenantsResponse] = await Promise.all([
        profileIds.length > 0
          ? supabase.from('profiles').select('id,full_name,email').in('id', profileIds)
          : Promise.resolve({ data: [], error: null }),
        tenantIds.length > 0
          ? supabase.from('tenants').select('id,name,slug').in('id', tenantIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (profilesResponse.error) throw profilesResponse.error
      if (tenantsResponse.error) throw tenantsResponse.error

      setProfilesById(Object.fromEntries((profilesResponse.data || []).map((item) => [item.id, item])))
      setTenantsById(Object.fromEntries((tenantsResponse.data || []).map((item) => [item.id, item])))
    } catch (loadError) {
      if (isSupportSchemaError(loadError)) {
        setSchemaMissing(true)
        setThreads([])
        setMessages([])
      } else {
        setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar suporte.')
      }
    } finally {
      setLoading(false)
    }
  }, [isGlobalAdmin, selectedThreadId])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  useEffect(() => {
    if (!isGlobalAdmin) return undefined
    const timer = setInterval(() => {
      if (!document.hidden) loadThreads()
    }, 30_000)
    return () => clearInterval(timer)
  }, [isGlobalAdmin, loadThreads])

  const loadMessages = useCallback(async () => {
    if (!selectedThreadId || !isGlobalAdmin) {
      setMessages([])
      return
    }
    setError('')
    try {
      const { data, error: messageError } = await supabase
        .from('support_messages')
        .select('id,thread_id,sender_profile_id,sender_type,body,created_at')
        .eq('thread_id', selectedThreadId)
        .order('created_at', { ascending: true })

      if (messageError) throw messageError
      setMessages(data || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar mensagens.')
    }
  }, [selectedThreadId, isGlobalAdmin])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  const claimThread = useCallback(async (thread) => {
    if (!thread?.id || !profile?.id || !isGlobalAdmin) return
    const alreadyClaimedByMe = thread.assigned_to === profile.id && thread.status === 'open'
    if (alreadyClaimedByMe) return

    setClaimingThreadId(thread.id)
    setError('')
    try {
      const agentName = profile?.full_name || profile?.email || 'YuiSync'
      const preset = `Agente ${agentName} entrou e assumiu este atendimento.`

      const [updateRes, messageRes] = await Promise.all([
        supabase
          .from('support_threads')
          .update({
            status: 'open',
            assigned_to: profile.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', thread.id),
        supabase
          .from('support_messages')
          .insert({
            thread_id: thread.id,
            tenant_id: thread.tenant_id,
            sender_profile_id: null,
            sender_type: 'system',
            body: preset,
          }),
      ])

      if (updateRes.error) throw updateRes.error
      if (messageRes.error) throw messageRes.error

      await loadThreads()
      if (selectedThreadId === thread.id) {
        await loadMessages()
      }
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Falha ao assumir chamado.')
    } finally {
      setClaimingThreadId('')
    }
  }, [profile?.id, profile?.full_name, profile?.email, isGlobalAdmin, loadThreads, loadMessages, selectedThreadId])

  async function handleSelectThread(thread) {
    setSelectedThreadId(thread.id)
    const shouldClaim = thread.status === 'pending' || !thread.assigned_to
    if (shouldClaim) {
      await claimThread(thread)
    }
  }

  useEffect(() => {
    if (!shouldAutoClaimFromHubAlert) return
    if (threads.length === 0) return

    const firstPriority = threads.find((thread) => !thread.assigned_to && (thread.status === 'pending' || thread.status === 'open'))
    if (!firstPriority) {
      navigate('/system/suporte', { replace: true })
      return
    }

    handleSelectThread(firstPriority).finally(() => {
      navigate('/system/suporte', { replace: true })
    })
  }, [shouldAutoClaimFromHubAlert, threads, navigate])

  async function sendReply() {
    if (!selectedThread || !reply.trim()) return
    setSending(true)
    setError('')
    try {
      const openStatusResult = await supabase
        .from('support_threads')
        .update({
          status: 'open',
          assigned_to: profile?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedThread.id)

      if (openStatusResult.error) throw openStatusResult.error

      const { data: inserted, error: insertError } = await supabase
        .from('support_messages')
        .insert({
          thread_id: selectedThread.id,
          tenant_id: selectedThread.tenant_id,
          sender_profile_id: profile?.id || null,
          sender_type: 'agent',
          body: reply.trim(),
        })
        .select('id,thread_id,sender_profile_id,sender_type,body,created_at')
        .single()

      if (insertError) throw insertError

      setMessages((prev) => [...prev, inserted])
      setReply('')
      await loadThreads()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Falha ao responder.')
    } finally {
      setSending(false)
    }
  }

  async function changeStatus(status) {
    if (!selectedThread || !THREAD_STATUSES.includes(status)) return
    setUpdatingStatus(status)
    setError('')
    try {
      const { error: updateError } = await supabase
        .from('support_threads')
        .update({
          status,
          assigned_to: profile?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedThread.id)

      if (updateError) throw updateError
      await loadThreads()
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Falha ao alterar status.')
    } finally {
      setUpdatingStatus('')
    }
  }

  if (!isGlobalAdmin) {
    return (
      <div className="page animate-fade-up max-w-4xl mx-auto">
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-200 flex items-center gap-3">
          <ShieldAlert size={18} />
          Esta central e exclusiva para Admin Global.
        </div>
      </div>
    )
  }

  return (
    <div className="page animate-fade-up max-w-7xl mx-auto pb-20 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <MessageSquare size={22} className={activeModule?.theme?.textPrimary} />
            Suporte Central
          </h1>
          <p className="page-sub">Inbox unico para atendimento e manutencao rapida dos clientes YuiSync.</p>
        </div>
        <button onClick={loadThreads} className="btn btn-secondary gap-2">
          <RefreshCw size={14} />
          Atualizar
        </button>
      </div>

      {pendingNotifications.length > 0 && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/12 px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-300 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-200">
              {pendingNotifications.length} chamado(s) pendente(s) aguardando agente
            </p>
            <p className="text-xs text-amber-100/90 mt-1">
              Ao abrir um chamado pendente, ele e assumido automaticamente e sai da notificacao dos outros admins globais.
            </p>
          </div>
        </div>
      )}

      {schemaMissing && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Estrutura de suporte nao encontrada. Rode o SQL <span className="font-bold">database/support_center.sql</span>.
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-4 min-h-[620px]">
        <div className="bg-card border border-white/10 rounded-3xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-[0.18em] text-muted font-black">
            Chamados
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-sm text-muted flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" /> Carregando...
              </div>
            ) : threads.length === 0 ? (
              <div className="p-6 text-sm text-muted">Sem chamados no momento.</div>
            ) : threads.map((thread) => {
              const requester = profilesById[thread.requester_profile_id]
              const assignedAgent = profilesById[thread.assigned_to]
              const tenant = tenantsById[thread.tenant_id]
              const selected = thread.id === selectedThreadId
              return (
                <button
                  key={thread.id}
                  onClick={() => handleSelectThread(thread)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/[0.03] ${
                    selected ? 'bg-white/[0.06]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-text truncate flex items-center gap-2">
                      {tenant?.name || 'Cliente'}
                      {!thread.assigned_to && (thread.status === 'pending' || thread.status === 'open') && (
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      )}
                    </p>
                    <span className={`badge ${statusBadge(thread.status)}`}>
                      {claimingThreadId === thread.id ? 'assumindo...' : thread.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1 truncate">{requester?.full_name || requester?.email || 'Usuario'}</p>
                  {assignedAgent && (
                    <p className="text-[11px] text-emerald-300 mt-1 truncate">
                      Assumido por {assignedAgent.full_name || assignedAgent.email}
                    </p>
                  )}
                  <p className="text-xs text-muted mt-1 truncate">{thread.subject || thread.last_message_preview || 'Sem assunto'}</p>
                  <p className="text-[11px] text-muted mt-1">{formatDateTime(thread.last_message_at || thread.created_at)}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="bg-card border border-white/10 rounded-3xl flex flex-col overflow-hidden">
          {selectedThread ? (
            <>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-text">{selectedThread.subject || 'Chamado de suporte'}</p>
                  <p className="text-xs text-muted">
                    {tenantsById[selectedThread.tenant_id]?.name || selectedThread.tenant_id} • {selectedThread.module_id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => changeStatus('pending')}
                    disabled={updatingStatus === 'pending'}
                    className="btn btn-sm btn-secondary gap-1"
                  >
                    <Clock3 size={12} />
                    Pendente
                  </button>
                  <button
                    onClick={() => changeStatus('open')}
                    disabled={updatingStatus === 'open'}
                    className="btn btn-sm btn-success gap-1"
                  >
                    <CheckCircle2 size={12} />
                    Aberto
                  </button>
                  <button
                    onClick={() => changeStatus('finalized')}
                    disabled={updatingStatus === 'finalized'}
                    className="btn btn-sm btn-danger gap-1"
                  >
                    <XCircle size={12} />
                    Finalizado
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-black/10">
                {messages.map((message) => {
                  const sender = profilesById[message.sender_profile_id]
                  const isAgent = message.sender_type === 'agent'
                  const isCustomer = message.sender_type === 'customer'
                  const bubbleClass = isAgent
                    ? 'ml-10 bg-emerald-500/10 border-emerald-500/30'
                    : isCustomer
                      ? 'mr-10 bg-primary/15 border-primary/25'
                      : 'mr-10 bg-white/5 border-white/10'
                  return (
                    <div key={message.id} className={`rounded-2xl border px-3 py-2 ${bubbleClass}`}>
                      <p className="text-[11px] text-muted mb-1">
                        {isAgent ? 'Equipe YuiSync' : isCustomer ? (sender?.full_name || 'Cliente') : 'Sistema'}
                      </p>
                      <p className="text-sm text-text">{message.body}</p>
                      <p className="text-[10px] text-muted mt-1">{formatDateTime(message.created_at)}</p>
                    </div>
                  )
                })}
              </div>

              <div className="p-4 border-t border-white/10 flex items-center gap-2">
                <input
                  className="inp h-11"
                  placeholder="Responder cliente..."
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      sendReply()
                    }
                  }}
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  className="btn btn-primary h-11 px-4 gap-2"
                >
                  {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  Enviar
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted">
              Selecione um chamado para responder.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
