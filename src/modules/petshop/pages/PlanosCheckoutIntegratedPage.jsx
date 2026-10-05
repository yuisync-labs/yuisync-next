import { useCallback, useEffect, useState } from 'react'
import { CreditCard, PackageCheck } from 'lucide-react'

import { PACKAGE_SCHEDULE_SAVED_EVENT } from '../components/PackageRecurringScheduleEnhancer'
import PackageActivationReliablePanel from './PackageActivationReliablePanel'
import PlanosNativePage from './PlanosNativePage'

const TABS = [
  { id: 'planos', label: 'Planos e assinantes', icon: PackageCheck },
  { id: 'pagamentos', label: 'Pagamentos', icon: CreditCard },
]

const EMBEDDED_PAGE_STYLES = `
  [data-yuisync-plan-native-content] > .page {
    height: auto !important;
    max-width: none !important;
    margin: 0 !important;
    overflow: visible !important;
    padding: 0 !important;
  }
`

export default function PlanosCheckoutIntegratedPage({ setPage }) {
  const [activeTab, setActiveTab] = useState('planos')
  const [checkoutVersion, setCheckoutVersion] = useState(0)
  const [plansVersion, setPlansVersion] = useState(0)

  useEffect(() => {
    const onPendingPayment = () => {
      setCheckoutVersion((current) => current + 1)
      setActiveTab('pagamentos')
    }
    const onScheduleSaved = (event) => {
      setCheckoutVersion((current) => current + 1)
      if (event.detail?.pendingPayment === true) setActiveTab('pagamentos')
    }
    window.addEventListener('yuisync:subscription-pending-payment', onPendingPayment)
    window.addEventListener(PACKAGE_SCHEDULE_SAVED_EVENT, onScheduleSaved)
    return () => {
      window.removeEventListener('yuisync:subscription-pending-payment', onPendingPayment)
      window.removeEventListener(PACKAGE_SCHEDULE_SAVED_EVENT, onScheduleSaved)
    }
  }, [])

  const handlePageChange = useCallback((nextPage) => {
    if (nextPage === 'ordens') {
      setCheckoutVersion((current) => current + 1)
      setActiveTab('pagamentos')
      return
    }
    setPage?.(nextPage)
  }, [setPage])

  const handleCheckoutChanged = useCallback(() => {
    setCheckoutVersion((current) => current + 1)
    setPlansVersion((current) => current + 1)
  }, [])

  return (
    <div className="page animate-fade-up" data-yuisync-plan-shell>
      <style>{EMBEDDED_PAGE_STYLES}</style>

      <nav className="flex w-fit max-w-full gap-1 rounded-xl border border-[var(--border)] bg-card p-1" aria-label="Seções de planos">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition-colors ${
                active
                  ? 'bg-emerald-500 text-gray-950 shadow-lg'
                  : 'text-muted hover:bg-white/5 hover:text-text'
              }`}
            >
              <Icon size={16}/>
              {tab.label}
            </button>
          )
        })}
      </nav>

      {activeTab === 'planos' ? (
        <div data-yuisync-plan-native-content>
          <PlanosNativePage key={plansVersion} setPage={handlePageChange} />
        </div>
      ) : (
        <section className="space-y-6" data-yuisync-plans-checkout-section>
          <div>
            <h1 className="page-title flex items-center gap-2">
              <CreditCard size={22} className="text-amber-400"/>
              Pagamentos de Pacotes
            </h1>
            <p className="page-sub">Receba, finalize a venda e libere os benefícios do pacote no mesmo fluxo.</p>
          </div>
          <PackageActivationReliablePanel
            key={checkoutVersion}
            onChanged={handleCheckoutChanged}
          />
        </section>
      )}
    </div>
  )
}
