import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, ChevronRight, Headphones, LockKeyhole, RefreshCcw, ShieldCheck } from 'lucide-react'
import YuiSyncMark from '../components/YuiSyncMark'
import MotionReveal from '../components/MotionReveal'
import { BILLING_CYCLES, COMMERCIAL_PLANS, formatPlanPrice, planPriceCents } from '../lib/commercialPlans'

const DEMO_HREF = 'mailto:gabrielboalento3004@gmail.com?subject=Demonstra%C3%A7%C3%A3o%20do%20YuiSync&body=Ol%C3%A1%2C%20quero%20conhecer%20o%20YuiSync.%0A%0AEmpresa%3A%0ANome%3A%0ATelefone%3A'
const HERO_ITEM = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }

function CycleSelector({ value, onChange }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Período de cobrança">
      {Object.values(BILLING_CYCLES).map((cycle) => (
        <button
          key={cycle.id}
          type="button"
          onClick={() => onChange(cycle.id)}
          aria-pressed={value === cycle.id}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${value === cycle.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
        >
          {cycle.label}
        </button>
      ))}
    </div>
  )
}

function PlanCard({ plan, cycle }) {
  const price = planPriceCents(plan, cycle)
  const dark = Boolean(plan.highlighted)
  const checkoutHref = `/vendas/contratar?plano=${plan.id}&ciclo=${cycle}${plan.custom ? '&contato=1' : ''}`

  return (
    <article className={`relative flex h-full flex-col overflow-hidden border p-6 sm:p-7 ${dark ? 'border-neutral-950 bg-[#0A0A0A] text-white shadow-[0_24px_65px_rgba(15,23,42,0.18)]' : 'border-slate-200 bg-white text-slate-950'}`}>
      {plan.badge && <span className={`absolute right-5 top-5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${dark ? 'bg-white text-black' : 'bg-slate-100 text-slate-600'}`}>{plan.badge}</span>}
      <p className={`pr-24 text-[10px] font-bold uppercase tracking-[0.18em] ${dark ? 'text-white/50' : 'text-slate-400'}`}>{plan.eyebrow}</p>
      <h2 className="mt-5 text-2xl font-extrabold tracking-[-0.035em]">{plan.name}</h2>
      <p className={`mt-3 min-h-[48px] text-sm leading-6 ${dark ? 'text-white/62' : 'text-slate-600'}`}>{plan.subtitle}</p>
      <div className={`mt-6 border-y py-5 ${dark ? 'border-white/10' : 'border-slate-200'}`}>
        <div className="flex items-end gap-1.5">
          <strong className="text-4xl font-extrabold tracking-[-0.045em]">{formatPlanPrice(price)}</strong>
          {!plan.custom && <span className={`pb-1 text-xs ${dark ? 'text-white/45' : 'text-slate-400'}`}>{BILLING_CYCLES[cycle].suffix}</span>}
        </div>
        {!plan.custom && cycle === 'yearly' && <p className={`mt-2 text-xs font-semibold ${dark ? 'text-white/60' : 'text-slate-500'}`}>Equivale a {formatPlanPrice(Math.round(price / 12))} por mês · dois meses de economia</p>}
        <p className={`mt-3 text-xs ${dark ? 'text-white/48' : 'text-slate-500'}`}>{plan.staffLimit}</p>
      </div>
      <p className={`mt-5 text-xs font-semibold ${dark ? 'text-white/55' : 'text-slate-500'}`}>Ideal para {plan.recommendedFor.toLowerCase()}.</p>
      <ul className="mt-5 flex-1 space-y-3">
        {plan.features.map((feature) => <li key={feature} className={`flex items-start gap-2.5 text-sm ${dark ? 'text-white/78' : 'text-slate-700'}`}><Check size={15} className="mt-0.5 shrink-0" strokeWidth={2.2} /><span>{feature}</span></li>)}
      </ul>
      <Link to={checkoutHref} className={`mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-all hover:-translate-y-0.5 ${dark ? 'bg-white text-black hover:bg-neutral-200' : 'border border-slate-300 bg-white text-slate-950 hover:border-slate-950'}`}>
        {plan.custom ? 'Falar com especialista' : 'Escolher este plano'} <ArrowRight size={15} />
      </Link>
    </article>
  )
}

export default function PublicSalesPage({ isAuthenticated = false }) {
  const [cycle, setCycle] = useState('monthly')
  const prefersReducedMotion = useReducedMotion()
  const entryHref = isAuthenticated ? '/' : '/entrar'

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden bg-[#F7F7F5] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#090909]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="YuiSync"><YuiSyncMark inverted className="h-8 w-8" /><span className="text-[16px] font-extrabold tracking-[-0.025em]">YuiSync</span></Link>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-white/60 md:flex"><Link to="/site#produto" className="transition-colors hover:text-white">Plataforma</Link><Link to="/site#recursos" className="transition-colors hover:text-white">Recursos</Link><Link to="/site#solucoes" className="transition-colors hover:text-white">Soluções</Link></nav>
          <Link to={entryHref} className="inline-flex min-h-10 items-center rounded-lg border border-white/15 px-4 text-sm font-bold transition-colors hover:bg-white hover:text-black">{isAuthenticated ? 'Abrir painel' : 'Entrar'}</Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#050505] text-white">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:linear-gradient(to_bottom,black,transparent_94%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_0.72fr] lg:items-end lg:py-20">
            <motion.div initial={prefersReducedMotion ? false : 'hidden'} animate="visible" transition={{ staggerChildren: 0.08 }}>
              <motion.p variants={HERO_ITEM} className="text-xs font-bold uppercase tracking-[0.2em] text-white/52">Planos YuiSync</motion.p>
              <motion.h1 variants={HERO_ITEM} className="mt-5 max-w-3xl text-5xl font-extrabold leading-[0.98] tracking-[-0.055em] sm:text-6xl">Um plano para colocar sua operação em sincronia.</motion.h1>
            </motion.div>
            <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.16 }}>
              <p className="text-base leading-7 text-white/65">Comece com o que sua equipe precisa agora e evolua sem trocar de sistema. Implantação assistida, dados isolados e cobrança transparente.</p>
              <a href={DEMO_HREF} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">Prefere conversar antes? Agende uma demonstração <ChevronRight size={14} /></a>
            </motion.div>
          </div>
        </section>

        <section id="planos" className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:py-20">
          <MotionReveal className="flex flex-col gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Escolha com clareza</p><h2 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">Preços simples, sem surpresa no segundo mês.</h2></div>
            <CycleSelector value={cycle} onChange={setCycle} />
          </MotionReveal>
          <MotionReveal className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4" delay={0.08}>{COMMERCIAL_PLANS.map((plan) => <PlanCard key={plan.id} plan={plan} cycle={cycle} />)}</MotionReveal>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl divide-y divide-slate-200 px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0">
            {[[ShieldCheck, 'Dados separados por empresa', 'Permissões e contexto operacional isolados em cada ambiente.'], [RefreshCcw, 'Plano que acompanha a operação', 'A troca de plano preserva o histórico e a rotina da equipe.'], [Headphones, 'Implantação acompanhada', 'Configuração inicial com suporte para entrar em operação com segurança.']].map(([Icon, title, description]) => (
              <article key={title} className="py-8 md:px-8 md:first:pl-0 md:last:pr-0"><Icon size={20} strokeWidth={1.8} className="text-slate-700" /><h3 className="mt-5 text-base font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:py-20">
          <div className="grid gap-8 bg-[#0A0A0A] px-7 py-10 text-white sm:px-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div><LockKeyhole size={22} className="text-white/70" /><h2 className="mt-6 max-w-2xl text-3xl font-extrabold tracking-[-0.04em]">Checkout seguro, operação acompanhada.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">O pagamento é processado pela Stripe. A ativação do ambiente continua vinculada ao onboarding do YuiSync.</p></div>
            <a href={DEMO_HREF} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-bold text-black hover:bg-neutral-200">Falar com a equipe <ArrowRight size={15} /></a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8"><div className="flex items-center gap-2.5"><YuiSyncMark decorative className="h-7 w-7" /><strong className="text-slate-800">YuiSync</strong><span>© 2026</span></div><div className="flex flex-wrap gap-5 font-semibold"><Link to="/privacidade">Privacidade</Link><Link to="/termos">Termos</Link><Link to="/site">Página inicial</Link></div></div></footer>
    </div>
  )
}
