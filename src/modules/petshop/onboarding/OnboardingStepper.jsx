import { Check } from 'lucide-react'

export function OnboardingStepper({ currentStep, maxAccessibleStep = currentStep, onStepChange, steps }) {
  return (
    <ol aria-label="Progresso da configuração" className="grid gap-2 sm:grid-cols-4">
      {steps.map((step, index) => {
        const number = index + 1
        const complete = maxAccessibleStep > number
        const active = currentStep === number
        const accessible = number <= maxAccessibleStep
        return (
          <li key={step} className="min-w-0">
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              aria-label={`${number}. ${step}${!accessible ? ' — conclua as etapas anteriores para acessar' : ''}`}
              disabled={!accessible || active}
              onClick={() => onStepChange?.(number)}
              className={`flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-colors ${active ? 'border-[var(--primary)] bg-[var(--primary-bg-light)] text-[var(--primary)]' : accessible ? 'cursor-pointer border-[var(--border2)] bg-surface text-muted hover:border-[var(--primary)] hover:text-[var(--primary)]' : 'cursor-not-allowed border-[var(--border2)] bg-surface text-muted opacity-55'}`}
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${complete ? 'bg-[var(--primary)] text-white' : 'border border-current'}`}>
                {complete ? <Check size={13} /> : number}
              </span>
              <span className="truncate">{step}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

