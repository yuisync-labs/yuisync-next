import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CircleCheck, CreditCard, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuthCtx } from '../../context/AuthContext'
import { createPlatformCheckout, getPlatformBillingCatalog } from '../../lib/api'
import YuiSyncMark from '../components/YuiSyncMark'
import { BILLING_CYCLES, commercialPlan, formatPlanPrice, planPriceCents } from '../lib/commercialPlans'

const CONTACT_EMAIL = 'gabrielboalento3004@gmail.com'

function inputClass() {
  return 'mt-2 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-950'
}

function checkoutErrorMessage(error) {
  if (error?.code === 'CHECKOUT_NOT_CONFIGURED' || error?.code === 'PLAN_PRICE_NOT_CONFIGURED') return 'O checkout está em configuração. Fale com a equipe YuiSync para concluir a contratação.'
  if (error?.code === 'CHECKOUT_RATE_LIMITED') return 'Foram feitas muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'
  if (error?.code === 'TENANT_ADMIN_REQUIRED') return 'Somente o responsável administrativo da empresa pode contratar ou trocar o plano.'
  if (error?.code === 'CHECKOUT_IN_PROGRESS') return 'Esta contratação já está sendo preparada. Aguarde alguns segundos e tente novamente.'
  return error?.message || 'Não foi possível abrir o checkout. Tente novamente ou fale com a equipe YuiSync.'
}

export default function PublicCheckoutPage({ isAuthenticated = false }) {
  const { activeTenantId, profile } = useAuthCtx()
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get('plano') || 'start'
  const selectedCycle = searchParams.get('ciclo') === 'yearly' ? 'yearly' : 'monthly'
  const plan = commercialPlan(selectedId)
  const [cycle, setCycle] = useState(selectedCycle)
  const [catalog, setCatalog] = useState(null)
  const [catalogChecked, setCatalogChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: profile?.full_name || profile?.name || '',
    email: profile?.email || '',
    phone: '',
    businessName: '',
    termsAccepted: false,
  })
  const returnStatus = searchParams.get('status')
  const isContactFlow = plan.custom || searchParams.get('contato') === '1'
  const entryHref = isAuthenticated ? '/' : '/entrar'
  const price = planPriceCents(plan, cycle)
  const planAvailability = catalog?.plans?.find((item) => item.id === plan.id)
  const checkoutAvailable = Boolean(planAvailability?.cycles?.includes(cycle))
  const contactHref = useMemo(() => {
    const subject = encodeURIComponent(`Contratação ${plan.name}`)
    const body = encodeURIComponent(`Olá, quero conversar sobre o ${plan.name}.\n\nEmpresa: ${form.businessName}\nNome: ${form.name}\nTelefone: ${form.phone}`)
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
  }, [form.businessName, form.name, form.phone, plan.name])

  useEffect(() => {
    let active = true
    getPlatformBillingCatalog()
      .then((result) => { if (active) setCatalog(result) })
      .catch(() => { if (active) setCatalog(null) })
      .finally(() => { if (active) setCatalogChecked(true) })
    return () => { active = false }
  }, [])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isContactFlow) {
      window.location.href = contactHref
      return
    }
    if (!form.termsAccepted) {
      setError('Confirme a leitura dos Termos e da Política de Privacidade.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const result = await createPlatformCheckout({
        tenantId: activeTenantId || undefined,
        planId: plan.id,
        billingCycle: cycle,
        customer: {
          name: form.name,
          email: form.email,
          phone: form.phone,
          businessName: form.businessName,
        },
        termsAccepted: true,
      })
      if (!result?.checkoutUrl) throw new Error('A Stripe não retornou uma página de pagamento válida.')
      window.location.assign(result.checkoutUrl)
    } catch (checkoutError) {
      setError(checkoutErrorMessage(checkoutError))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-slate-950">
      <header className="border-b border-white/[0.08] bg-[#090909] text-white">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5"><YuiSyncMark inverted className="h-8 w-8" /><span className="text-[16px] font-extrabold tracking-[-0.025em]">YuiSync</span></Link>
          <Link to={entryHref} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-bold transition-colors hover:bg-white hover:text-black">{isAuthenticated ? 'Abrir painel' : 'Entrar'}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
        <Link to="/vendas#planos" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-950"><ArrowLeft size={15} /> Voltar para os planos</Link>

        {returnStatus === 'sucesso' && (
          <div className="mt-8 border border-emerald-200 bg-emerald-50 p-5 text-emerald-950" role="status">
            <div className="flex items-start gap-3"><CircleCheck className="mt-0.5 shrink-0 text-emerald-600" size={20} /><div><strong className="block">Retorno do pagamento recebido.</strong><p className="mt-1 text-sm leading-6 text-emerald-800">A Stripe ainda confirmará a assinatura pelo canal seguro do servidor. Nossa equipe seguirá com a ativação do ambiente.</p></div></div>
          </div>
        )}
        {returnStatus === 'cancelado' && <div className="mt-8 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">O checkout foi fechado sem cobrança. Seus dados não foram usados para ativar uma assinatura.</div>}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.12fr)_420px] lg:items-start">
          <section>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Contratação segura</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-extrabold leading-[1.04] tracking-[-0.045em] sm:text-5xl">{isContactFlow ? 'Vamos entender sua operação.' : `Configure seu ${plan.name}.`}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{isContactFlow ? 'Envie o contexto inicial e nossa equipe prepara uma proposta adequada ao seu cenário.' : 'Confirme os dados do responsável. O pagamento acontece no ambiente protegido da Stripe.'}</p>

            <form onSubmit={handleSubmit} className="mt-9 border border-slate-200 bg-white p-6 sm:p-8">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-bold text-slate-700">Nome do responsável<input required maxLength={120} autoComplete="name" value={form.name} onChange={(event) => updateField('name', event.target.value)} className={inputClass()} placeholder="Seu nome completo" /></label>
                <label className="text-sm font-bold text-slate-700">E-mail de cobrança<input required type="email" maxLength={180} autoComplete="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} className={inputClass()} placeholder="voce@empresa.com.br" /></label>
                <label className="text-sm font-bold text-slate-700">Telefone<input maxLength={32} autoComplete="tel" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} className={inputClass()} placeholder="(32) 99999-9999" /></label>
                <label className="text-sm font-bold text-slate-700">Nome da empresa<input required maxLength={160} autoComplete="organization" value={form.businessName} onChange={(event) => updateField('businessName', event.target.value)} className={inputClass()} placeholder="Nome do seu negócio" /></label>
              </div>

              {!isContactFlow && (
                <label className="mt-6 flex cursor-pointer items-start gap-3 border-t border-slate-200 pt-6 text-sm leading-6 text-slate-600">
                  <input type="checkbox" checked={form.termsAccepted} onChange={(event) => updateField('termsAccepted', event.target.checked)} className="mt-1 h-4 w-4 accent-slate-950" />
                  <span>Li e aceito os <Link to="/termos" target="_blank" className="font-bold text-slate-950 underline underline-offset-2">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank" className="font-bold text-slate-950 underline underline-offset-2">Política de Privacidade</Link>.</span>
                </label>
              )}

              {error && <div className="mt-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>}

              {isContactFlow ? (
                <button type="submit" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white hover:bg-slate-800">Enviar contexto por e-mail <ArrowRight size={15} /></button>
              ) : (
                <button type="submit" disabled={busy || (catalogChecked && !checkoutAvailable)} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                  <CreditCard size={16} /> {busy ? 'Abrindo checkout seguro…' : catalogChecked && !checkoutAvailable ? 'Checkout em configuração' : 'Continuar para a Stripe'}
                </button>
              )}
              {!isContactFlow && catalogChecked && !checkoutAvailable && <p className="mt-3 text-center text-xs text-slate-500">Este período ainda não foi conectado a um preço da Stripe. A contratação assistida continua disponível.</p>}
            </form>
          </section>

          <aside className="border border-neutral-950 bg-[#0A0A0A] p-6 text-white sm:p-7 lg:sticky lg:top-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Resumo do plano</p><h2 className="mt-3 text-2xl font-extrabold tracking-[-0.035em]">{plan.name}</h2></div><ShieldCheck size={21} className="text-white/60" /></div>
            {!plan.custom && <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.06] p-1">{Object.values(BILLING_CYCLES).map((item) => <button key={item.id} type="button" onClick={() => setCycle(item.id)} className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${cycle === item.id ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}>{item.label}</button>)}</div>}
            <div className="mt-6 border-y border-white/10 py-5"><div className="flex items-end gap-1.5"><strong className="text-4xl font-extrabold tracking-[-0.045em]">{formatPlanPrice(price)}</strong>{!plan.custom && <span className="pb-1 text-xs text-white/45">{BILLING_CYCLES[cycle].suffix}</span>}</div>{!plan.custom && cycle === 'yearly' && <p className="mt-2 text-xs text-white/55">Dois meses de economia no ciclo anual.</p>}</div>
            <ul className="mt-6 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2.5 text-sm text-white/72"><Check size={15} className="mt-0.5 shrink-0" /><span>{feature}</span></li>)}</ul>
            <div className="mt-7 flex items-start gap-3 border-t border-white/10 pt-6"><LockKeyhole size={17} className="mt-0.5 shrink-0 text-white/55" /><p className="text-xs leading-5 text-white/48">O YuiSync não recebe nem armazena os dados do cartão. A etapa financeira é processada pela Stripe.</p></div>
          </aside>
        </div>
      </main>
    </div>
  )
}
