import { Check, LockKeyhole, MessageCircleMore, Sparkles } from 'lucide-react'

import { Card, CardContent, CardHeader, StatusBadge } from '../../../components/ui'
import { PLAN_MODULE_LABELS, hasPlanModule } from '../../../config/planEntitlements'

export function ModuleUnlockPreview({ plan, onConnectWhatsapp }) {
  const allowed = plan?.modules || []
  const supportsWhatsapp = hasPlanModule(allowed, 'whatsapp_basic')
  const supportsAi = hasPlanModule(allowed, 'petbot_ai')

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Seu plano</p>
            <h2 className="mt-1 text-xl font-black text-text">{plan?.name || 'YuiSync'}</h2>
          </div>
          <StatusBadge variant="success">{allowed.length} módulos liberados</StatusBadge>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {Object.entries(PLAN_MODULE_LABELS).map(([moduleId, label]) => {
            const unlocked = hasPlanModule(allowed, moduleId)
            return (
              <div key={moduleId} className="flex items-center gap-3 border-b border-[var(--border2)] px-1 py-3 last:border-0 sm:[&:nth-last-child(-n+2)]:border-0">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${unlocked ? 'bg-[var(--ui-success-bg)] text-[var(--ui-success-fg)]' : 'bg-[var(--surface)] text-muted'}`}>
                  {unlocked ? <Check size={15} /> : <LockKeyhole size={14} />}
                </span>
                <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${unlocked ? 'text-text' : 'text-muted'}`}>{label}</p><p className="text-[11px] text-muted">{unlocked ? 'Disponível agora' : 'Disponível em outro plano'}</p></div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {supportsWhatsapp && (
        <Card tone="info">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--ui-info-bg)] text-[var(--ui-info-fg)]">
              {supportsAi ? <Sparkles size={21} /> : <MessageCircleMore size={21} />}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-text">Conexão oficial com a Meta</h3>
              <p className="mt-1 text-sm leading-6 text-muted">{supportsAi ? 'Seu plano inclui WhatsApp com PetBot. A conexão usa o fluxo seguro da Meta API e abre em outra aba.' : 'Seu plano inclui atendimento manual e regras básicas pelo WhatsApp. A conexão abre em outra aba.'}</p>
            </div>
            <button type="button" onClick={onConnectWhatsapp} className="btn btn-secondary shrink-0">Conectar com a Meta</button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

