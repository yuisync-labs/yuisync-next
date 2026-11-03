import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Headset, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthCtx } from '../context/AuthContext'

function formatWhen(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function SystemSupportPriorityAlert() {
  const navigate = useNavigate()
  const { profile } = useAuthCtx()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])

  const isGlobalAdmin = profile?.role === 'admin'

  const loadPriority = useCallback(async () => {
    if (!isGlobalAdmin) return
    try {
      const { data, error } = await supabase
        .from('support_threads')
        .select('id,subject,status,last_message_at,tenant_id,module_id,assigned_to')
        .is('assigned_to', null)
        .in('status', ['pending', 'open'])
        .order('last_message_at', { ascending: false })
        .limit(30)

      if (error) throw error
      setItems(data || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [isGlobalAdmin])

  useEffect(() => {
    loadPriority()
  }, [loadPriority])

  useEffect(() => {
    if (!isGlobalAdmin) return undefined
    // Mounted on every page: poll only while the tab is visible, once a minute.
    const timer = setInterval(() => { if (!document.hidden) loadPriority() }, 60_000)
    return () => clearInterval(timer)
  }, [isGlobalAdmin, loadPriority])

  const topItem = useMemo(() => items[0] || null, [items])
  if (!isGlobalAdmin || (!loading && items.length === 0)) return null

  return (
    <div className="fixed top-4 right-5 z-[55] w-[360px] max-w-[92vw] rounded-2xl border border-amber-400/40 bg-[#20140a]/95 shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-amber-300 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-200">Prioridade global de suporte</p>
          {loading ? (
            <p className="text-xs text-amber-100/90 mt-1 flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin" />
              Verificando chamados...
            </p>
          ) : (
            <>
              <p className="text-xs text-amber-100/90 mt-1">
                {items.length} chamado(s) sem agente aguardando atendimento.
              </p>
              {topItem && (
                <p className="text-[11px] text-amber-100/80 mt-1 truncate">
                  {topItem.subject || `Suporte ${topItem.module_id}`} • {formatWhen(topItem.last_message_at)}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-3">
        <button
          onClick={() => navigate('/system/suporte?auto_claim=1')}
          className="btn btn-sm btn-primary gap-1.5 w-full justify-center"
        >
          <Headset size={13} />
          Ir para atendimento
        </button>
      </div>
    </div>
  )
}
