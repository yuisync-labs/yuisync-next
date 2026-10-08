import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  MessageSquare, Plus, Send, Bot, User, Phone,
  UserCheck, ArrowLeft, RefreshCw, X, Check,
  ChevronRight, Inbox, Zap, Clock, BellRing
} from 'lucide-react'
import { useChat }    from '../../../shared/hooks/useChat'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { fmtDateTime } from '../../../lib/supabase'
import { resetChatHistory } from '../../../lib/api'
import { lunaTurnLabels } from '../../../lib/lunaTurnPolling'

// ── Message Bubble ────────────────────────────────────────────────────────────
function isImageUrl(value = '') {
  return /^https?:\/\/\S+/i.test(String(value || ''))
    && /(\.png|\.jpg|\.jpeg|\.webp|\/object\/sign\/|\/object\/public\/)/i.test(String(value || ''))
}

function getMessageImageUrl(msg) {
  const metadataUrl = String(msg?.metadata?.image_url || '').trim()
  if (isImageUrl(metadataUrl)) return metadataUrl

  const content = String(msg?.content || '').trim()
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const lastLine = lines[lines.length - 1] || ''
  return isImageUrl(lastLine) ? lastLine : ''
}

function getVisibleMessageText(msg, imageUrl) {
  const content = String(msg?.content || '')
  if (!imageUrl) return content
  return content
    .replace(imageUrl, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function MessageBubble({ msg, activeModule, isFirstInGroup }) {
  const isUser   = msg.role === 'user'
  const isBot    = msg.role === 'assistant'
  const isHuman  = msg.role === 'human_agent'
  const isOwnMessage = !isUser
  const imageUrl = getMessageImageUrl(msg)
  const visibleText = getVisibleMessageText(msg, imageUrl)

  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} ${isFirstInGroup ? 'mt-4' : 'mt-1'} mb-1 group`}>
      <div className={`flex ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'} max-w-[85%] items-end gap-2.5`}>
        
        {/* Avatar section (only for Bot/Agent, and only on first message of group) */}
        {isOwnMessage && (
          <div className="w-8 flex-shrink-0 flex items-end">
            {isFirstInGroup ? (
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 mb-1`}
                   style={{ 
                     backgroundColor: isBot ? 'var(--primary-bg-light)' : 'rgba(139, 92, 246, 0.15)',
                     color: isBot ? 'var(--primary)' : 'rgba(167, 139, 250, 1)',
                     border: isBot ? '1px solid var(--primary-border)' : '1px solid rgba(139, 92, 246, 0.2)'
                   }}>
                {isBot ? <Bot size={16}/> : <User size={16}/>}
              </div>
            ) : <div className="w-8" />}
          </div>
        )}

        <div className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
          {/* Sender name - Only on first in group */}
          {isOwnMessage && isFirstInGroup && (
            <span className="text-[10px] font-black uppercase tracking-widest text-muted mb-1 px-1 opacity-70">
              {isBot ? (activeModule.id === 'petshop' ? 'PetBot 🤖' : 'Assistente IA 🤖') : 'Agente Autorizado 👤'}
            </span>
          )}

          {/* Bubble */}
          <div className={`${isUser ? 'bubble-user' : isHuman ? 'bubble-human' : 'bubble-bot'} transition-all hover:brightness-110`}>
            {visibleText ? (
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap font-medium">{visibleText}</p>
            ) : null}
            {imageUrl ? (
              <div className={visibleText ? 'mt-3' : ''}>
                <img
                  src={imageUrl}
                  alt="Midia da conversa"
                  className="rounded-2xl border border-white/10 max-w-[280px] w-full object-cover bg-black/20"
                />
              </div>
            ) : null}
          </div>

          {/* Footer info (time/tokens) - Show only time for users, time+tokens for bot */}
          <div className={`flex items-center gap-1.5 mt-1 px-1.5 opacity-0 group-hover:opacity-40 transition-opacity`}>
            <span className="text-[9px] font-bold tracking-tighter">
              {msg.sent_at ? new Date(msg.sent_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : ''}
              {isBot && msg.tokens_used ? ` · ${msg.tokens_used}t` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Session Card ──────────────────────────────────────────────────────────────
function SessionCard({ session, active, onClick, statusConfig }) {
  const sc = statusConfig(session.status)
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-[var(--border2)] transition-colors hover:bg-white/3 ${active ? 'active-session' : ''}`}
      style={{
        backgroundColor: active ? 'var(--primary-bg-light)' : undefined,
        borderLeft: active ? '2px solid var(--primary)' : undefined
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`}/>
          <p className="font-semibold text-text text-sm truncate">
            {session.customer_name || session.customer_phone || 'Cliente'}
          </p>
        </div>
        <span className={`badge ${sc.cls} text-[10px] flex-shrink-0`}>{sc.label}</span>
      </div>
      {session.pets && (
        <p className="text-xs text-muted pl-4">{session.pets.pet_name} 🐾</p>
      )}
      <p className="text-xs text-muted pl-4 mt-1">
        {session.last_message_at ? fmtDateTime(session.last_message_at) : '—'}
      </p>
      {session.intent && (
        <span className="ml-4 mt-1.5 badge badge-gray text-[10px] capitalize">{session.intent}</span>
      )}
    </button>
  )
}

// ── New Session Modal ─────────────────────────────────────────────────────────
function NewSessionModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ customer_name:'', customer_phone:'', channel:'whatsapp' })
  const [saving, setSaving] = useState(false)
  const [creationError, setCreationError] = useState('')

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  async function handleSubmit() {
    if (!form.customer_phone.trim() || saving) return
    setCreationError('')
    setSaving(true)
    try {
      await onCreate(form)
      onClose()
    } catch {
      setCreationError('Não foi possível iniciar a conversa. Verifique os dados e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-sm">
        <div className="modal-header">
           <h2 className="font-display font-bold text-xl text-text">Nova Conversa</h2>
           <button onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>

        <div className="modal-body space-y-6">
          <div className="bg-white/5 border border-white/5 rounded-2xl p-5 mb-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mx-auto mb-3 border border-primary/10 shadow-inner">
               <MessageSquare size={22}/>
            </div>
            <p className="text-[11px] text-muted uppercase tracking-widest font-black">Iniciar Atendimento</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="inp-label">Telefone / WhatsApp *</label>
              <input className="inp" placeholder="(32) 99999-9999"
                value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)}/>
            </div>
            <div>
              <label className="inp-label">Nome do Cliente</label>
              <input className="inp" placeholder="Nome (opcional)"
                value={form.customer_name} onChange={e => set('customer_name', e.target.value)}/>
            </div>
            <div>
              <label className="inp-label">Canal de Origem</label>
              <select className="inp" value={form.channel} onChange={e => set('channel', e.target.value)}>
                <option value="whatsapp">WhatsApp Business</option>
                <option value="instagram">Instagram Direct</option>
                <option value="website">Web Chat</option>
                <option value="interno">Canal Interno</option>
              </select>
            </div>
          </div>

          {creationError && <p role="alert" className="text-sm text-red-400">{creationError}</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn btn-secondary flex-1 justify-center border-white/5">Cancelar</button>
            <button onClick={handleSubmit} disabled={saving || !form.customer_phone}
              className="btn btn-primary flex-1 justify-center shadow-lg font-black text-xs uppercase tracking-widest">
              {saving ? 'Criando...' : 'Iniciar Chat'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Página Principal ──────────────────────────────────────────────────────────
function HandoffAlerts({ alerts, onDismiss, onOpen }) {
  if (!alerts?.length) return null

  return createPortal(
    <div className="fixed right-4 top-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      {alerts.map((alert) => {
        const isVet = alert.target === 'veterinaria'
        return (
          <div
            key={alert.id}
            className={`rounded-2xl border bg-card/95 p-4 shadow-2xl backdrop-blur-xl ${
              isVet ? 'border-red-500/25' : 'border-amber-500/25'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                isVet ? 'bg-red-500/12 text-red-400' : 'bg-amber-500/12 text-amber-400'
              }`}>
                <BellRing size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-text">
                  {isVet ? 'Veterinaria necessaria' : 'Atendente necessario'}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-muted">
                  {alert.customerName}
                </p>
                {alert.reason && (
                  <p className="mt-1 text-[11px] uppercase tracking-widest text-muted">
                    Motivo: {String(alert.reason).replace(/_/g, ' ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="text-muted hover:text-text"
                onClick={() => onDismiss(alert.id)}
                title="Dispensar"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm flex-1 justify-center"
                onClick={() => onOpen(alert)}
              >
                Abrir chat
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onDismiss(alert.id)}
              >
                Dispensar
              </button>
            </div>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

export default function ChatPage() {
  const {
    sessions, messages, activeSession, botTyping, botTurn, quickReplies,
    handoffAlerts,
    loadSessions, loadMessages, loadQuickReplies, openSession, createSession,
    sendClientMessage, sendHumanMessage,
    takeOver, returnToBot, closeSession,
    subscribeSessionsList, setActiveSession, statusConfig, dismissHandoffAlert,
  } = useChat()
  const auth = useAuthCtx()
  const { activeModule } = useModuleCtx()

  const [input, setInput]         = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [sending, setSending]     = useState(false)
  const [resettingHistory, setResettingHistory] = useState(false)
  const [mobileView, setMobileView] = useState('list') // 'list' | 'chat' (mobile only)
  const bottomRef = useRef(null)
  const restoredSessionRef = useRef(false)
  const isGlobalAdmin = auth?.profile?.role === 'admin'
  const activeChatStorageKey = `@yuisync-active-chat:${auth?.activeTenantId || 'tenant'}:${activeModule.id}`

  const handleOpenSession = async (session) => {
    await openSession(session)
    sessionStorage.setItem(activeChatStorageKey, session.id)
    setMobileView('chat')
  }

  useEffect(() => {
    loadSessions(statusFilter || undefined)
    loadQuickReplies()
    subscribeSessionsList()
  }, [statusFilter])

  useEffect(() => {
    if (restoredSessionRef.current || activeSession || sessions.length === 0) return
    restoredSessionRef.current = true
    const savedSessionId = sessionStorage.getItem(activeChatStorageKey)
    const savedSession = sessions.find((session) => session.id === savedSessionId)
    if (savedSession) void handleOpenSession(savedSession)
  }, [activeChatStorageKey, activeSession, sessions])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, botTyping])

  const handleOpenHandoffAlert = async (alert) => {
    const session = sessions.find((item) => item.id === alert.sessionId) || {
      id: alert.sessionId,
      customer_name: alert.customerName,
      status: 'human',
    }
    await handleOpenSession(session)
    dismissHandoffAlert(alert.id)
  }

  const handleSend = async () => {
    if (!input.trim() || !activeSession) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      if (activeSession.status === 'human') {
        await sendHumanMessage(activeSession.id, text, auth?.profile?.id)
      } else {
        await sendClientMessage(activeSession.id, text)
      }
    } finally {
      setSending(false)
    }
  }

  const handleResetHistory = async () => {
    if (!isGlobalAdmin || resettingHistory) return
    const ok = window.confirm('Resetar todo o historico de mensagens e conversas deste modulo/negocio? Esta acao e permanente.')
    if (!ok) return
    setResettingHistory(true)
    try {
      await resetChatHistory({
        moduleId: activeModule.id,
        tenantId: auth?.activeTenantId,
      })
      sessionStorage.removeItem(activeChatStorageKey)
      setActiveSession(null)
      await loadSessions(statusFilter || undefined)
    } finally {
      setResettingHistory(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const filtered = sessions.filter(s =>
    !statusFilter || s.status === statusFilter
  )

  const openCount   = sessions.filter(s => s.status !== 'closed').length
  const botCount    = sessions.filter(s => s.status === 'bot').length
  const humanCount  = sessions.filter(s => s.status === 'human').length

  const emoji = activeModule.id === 'petshop' ? '🐾' : '💬'
  const botTitle = activeModule.id === 'petshop' ? 'PetBot Central' : 'Assistente Virtual'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 lg:px-8 pt-6 pb-4 flex-shrink-0 border-b border-[var(--border2)]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <MessageSquare size={22} style={{ color: 'var(--primary)' }}/> Chat IA
            </h1>
            <p className="page-sub">Central de atendimento</p>
          </div>
          <div className="flex items-center gap-2">
            {isGlobalAdmin && (
              <button onClick={handleResetHistory} disabled={resettingHistory} className="btn btn-secondary text-red-500 border-red-500/20">
                <RefreshCw size={16} className={resettingHistory ? 'animate-spin' : ''}/> Reset Historico
              </button>
            )}
            <button onClick={() => setShowModal(true)} className="btn btn-primary">
              <Plus size={16}/> Nova Conversa
            </button>
          </div>
        </div>
        {/* Summary pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { label:`${openCount} Abertos`, value:'', cls:''  }, // Removed hardcoded amber
            { label:`${botCount} Bot`,      value:'bot',   cls:'badge-amber'  },
            { label:`${humanCount} Atendente`, value:'human', cls:'badge-purple'},
          ].map(f => (
            <button key={f.value}
              onClick={() => setStatusFilter(v => v === f.value ? '' : f.value)}
              className={`badge ${statusFilter === f.value ? (f.value==='' ? 'badge-gray' : f.cls) : 'badge-gray'} cursor-pointer hover:opacity-80 transition-opacity`}
              style={statusFilter === f.value && f.value === '' ? { backgroundColor: 'var(--primary-bg-light)', color: 'var(--primary)', borderColor: 'var(--primary-border)' } : {}}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Session list */}
        <div className={`w-72 flex-shrink-0 border-r border-[var(--border2)] flex flex-col overflow-hidden
          ${mobileView === 'chat' ? 'hidden lg:flex' : 'flex'}`}>

          {/* Status filter */}
          <div className="px-3 py-2.5 border-b border-[var(--border2)]">
            <select className="inp py-1.5 text-xs" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">Todas as conversas</option>
              <option value="bot">🤖 Bot</option>
              <option value="human">👤 Atendente</option>
              <option value="waiting">⏳ Aguardando</option>
              <option value="closed">✓ Fechadas</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-4">
                <Inbox size={32} className="text-muted/30"/>
                <p className="text-sm text-muted text-center">Nenhuma conversa</p>
                <button onClick={() => setShowModal(true)} className="btn btn-primary btn-sm">
                  <Plus size={13}/> Nova Conversa
                </button>
              </div>
            ) : (
              filtered.map(s => (
                <SessionCard
                  key={s.id}
                  session={s}
                  active={activeSession?.id === s.id}
                  onClick={() => handleOpenSession(s)}
                  statusConfig={statusConfig}
                />
              ))
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className={`flex-1 flex flex-col overflow-hidden
          ${mobileView === 'list' ? 'hidden lg:flex' : 'flex'}`}>
          {!activeSession ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center" 
                   style={{ backgroundColor: 'var(--primary-bg-light)', border: '1px solid var(--primary-border)' }}>
                <span className="text-4xl">{emoji}</span>
              </div>
              <div className="text-center">
                <h2 className="font-display font-bold text-xl text-text">{botTitle}</h2>
                <p className="text-muted text-sm mt-1">Selecione uma conversa ou crie uma nova</p>
              </div>
              <div className="flex gap-3 mt-2">
                <div className="bg-card border border-[var(--border)] rounded-xl p-4 text-center">
                  <Bot size={20} className="mx-auto mb-1" style={{ color: 'var(--primary)' }}/>
                  <p className="font-display font-bold text-2xl text-text">{botCount}</p>
                  <p className="text-xs text-muted">No bot</p>
                </div>
                <div className="bg-card border border-[var(--border)] rounded-xl p-4 text-center">
                  <UserCheck size={20} className="text-violet-400 mx-auto mb-1"/>
                  <p className="font-display font-bold text-2xl text-text">{humanCount}</p>
                  <p className="text-xs text-muted">Com atendente</p>
                </div>
                <div className="bg-card border border-[var(--border)] rounded-xl p-4 text-center">
                  <Zap size={20} className="text-amber-400 mx-auto mb-1"/>
                  <p className="font-display font-bold text-2xl text-text">{openCount}</p>
                  <p className="text-xs text-muted">Abertos</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-5 py-3.5 border-b border-[var(--border2)] flex items-center gap-3 flex-shrink-0">
                <button onClick={() => { setMobileView('list'); setActiveSession(null) }}
                  className="lg:hidden text-muted hover:text-text">
                  <ArrowLeft size={18}/>
                </button>
                <div className={`w-2.5 h-2.5 rounded-full ${statusConfig(activeSession.status).dot}`}/>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text truncate">
                    {activeSession.customer_name || activeSession.customer_phone || 'Cliente'}
                  </p>
                  <p className="text-xs text-muted">
                    {statusConfig(activeSession.status).label}
                    {activeSession.pets && ` · ${activeSession.pets.pet_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeSession.status === 'bot' && (
                    <button
                      onClick={() => takeOver(activeSession.id, auth?.profile?.id)}
                      className="btn btn-secondary btn-sm">
                      <UserCheck size={13}/> Assumir
                    </button>
                  )}
                  {activeSession.status === 'human' && (
                    <button
                      onClick={() => returnToBot(activeSession.id)}
                      className="btn btn-secondary btn-sm">
                      <Bot size={13}/> Devolver ao Bot
                    </button>
                  )}
                  {activeSession.status !== 'closed' && (
                    <button
                      onClick={() => closeSession(activeSession.id)}
                      className="btn btn-ghost btn-sm">
                      <Check size={13}/> Fechar
                    </button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Bot size={32} className="text-muted/30"/>
                    <p className="text-sm text-muted">Nenhuma mensagem ainda</p>
                    <p className="text-xs text-muted">Use o campo abaixo para simular uma mensagem do cliente</p>
                  </div>
                ) : (
                  <>
                    {messages.map((m, idx) => {
                      const prev = messages[idx - 1]
                      const isFirstInGroup = !prev || prev.role !== m.role
                      return (
                        <MessageBubble
                          key={m.id}
                          msg={m}
                          activeModule={activeModule}
                          isFirstInGroup={isFirstInGroup}
                        />
                      )
                    })}
                    {botTyping && (
                      <div className="flex flex-row-reverse items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--primary-bg-light)' }}>
                          <Bot size={14} style={{ color: 'var(--primary)' }}/>
                        </div>
                        <div className="bubble-bot py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--primary)', animationDelay:'0ms'}}/>
                            <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--primary)', animationDelay:'150ms'}}/>
                            <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--primary)', animationDelay:'300ms'}}/>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef}/>
                  </>
                )}
              </div>

              {/* Status bar & input */}
              {botTurn && (
                <div role="status" className="px-4 py-2 text-xs text-muted border-t border-[var(--border2)]">
                  {lunaTurnLabels[botTurn.status] || 'Estado do turno'}
                  {botTurn.errorCode ? ` · ${botTurn.errorCode} — turno preservado; não reenvie.` : ''}
                  {botTurn.diagnostic ? ` · ${botTurn.diagnostic}` : ''}
                </div>
              )}
              {activeSession.status !== 'closed' && (
                <div className="border-t border-[var(--border2)] flex-shrink-0">
                  {/* Quick Replies */}
                  {activeSession.status === 'human' && quickReplies.length > 0 && (
                    <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-[var(--border2)] scrollbar-hide">
                      {quickReplies.map(qr => (
                        <button
                          key={qr.id}
                          onClick={() => setInput(qr.text || '')}
                          className="badge badge-gray whitespace-nowrap cursor-pointer transition-all"
                          title={qr.title}
                        >
                          <Zap size={10} className="mr-1 opacity-60" /> {qr.title}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Mode indicator */}
                  <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b border-[var(--border2)] ${
                    activeSession.status === 'human'
                      ? 'bg-violet-500/8 text-violet-400'
                      : ''
                  }`} style={activeSession.status !== 'human' ? { backgroundColor: 'var(--primary-bg-light)', color: 'var(--primary)' } : {}}>
                    {activeSession.status === 'human' ? (
                      <><User size={12}/> Você está respondendo como agente</>
                    ) : (
                      <><Bot size={12}/> Simulando mensagem do cliente para o Bot</>
                    )}
                  </div>

                  {/* Input */}
                  <div className="flex items-end gap-2 px-4 py-3">
                    <textarea
                      className="flex-1 bg-surface border border-[var(--border2)] rounded-xl px-3.5 py-2.5 text-sm text-text
                        placeholder:text-muted outline-none transition-all resize-none min-h-[42px] max-h-[120px] focus:ring-1"
                      style={{ '--tw-ring-color': 'var(--primary-bg-light)' }}
                      placeholder={
                        activeSession.status === 'human'
                          ? 'Digite sua resposta como agente...'
                          : 'Simule uma mensagem do cliente...'
                      }
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={1}
                    />
                    <button
                      onClick={handleSend}
                      disabled={sending || !input.trim()}
                      className="btn btn-primary btn-icon h-[42px] w-[42px] justify-center flex-shrink-0 disabled:opacity-50">
                      <Send size={16}/>
                    </button>
                  </div>
                </div>
              )}

              {activeSession.status === 'closed' && (
                <div className="px-4 py-3 border-t border-[var(--border2)] text-center">
                  <p className="text-sm text-muted">Esta conversa foi encerrada</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* New Session Modal */}
      {showModal && (
        <NewSessionModal
          onClose={() => setShowModal(false)}
          onCreate={createSession}
        />
      )}
      <HandoffAlerts
        alerts={handoffAlerts}
        onDismiss={dismissHandoffAlert}
        onOpen={handleOpenHandoffAlert}
      />
    </div>
  )
}
