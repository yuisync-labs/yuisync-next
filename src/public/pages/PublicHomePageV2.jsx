import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PawPrint,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UsersRound,
  X,
} from 'lucide-react'
import YuiSyncMark from '../components/YuiSyncMark'
import ConnectionSphere from '../components/ConnectionSphere'
import MotionReveal from '../components/MotionReveal'
import { PlatformGrid } from '../components/PlatformMotion'

const HERO_ITEM = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0 },
}

const HERO_SEQUENCE = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
}

const DEMO_HREF = 'mailto:gabrielboalento3004@gmail.com?subject=Demonstra%C3%A7%C3%A3o%20do%20YuiSync&body=Ol%C3%A1%2C%20quero%20conhecer%20o%20YuiSync.%0A%0AEmpresa%3A%0ANome%3A%0ATelefone%3A'

const BENEFITS = [
  {
    eyebrow: 'Operação',
    title: 'Enxergue o trabalho acontecendo em uma única visão.',
    text: 'Agenda, vendas e rotinas deixam de viver em telas soltas e passam a compartilhar o mesmo contexto.',
    icon: CalendarDays,
  },
  {
    eyebrow: 'Gestão',
    title: 'Transforme cada ação da equipe em informação útil para decidir.',
    text: 'O que acontece no atendimento, no caixa e no estoque permanece conectado à gestão da operação.',
    icon: ShoppingCart,
  },
  {
    eyebrow: 'Relacionamento',
    title: 'Mantenha o histórico perto de quem atende e vende.',
    text: 'Clientes, conversas e atendimentos ficam ligados para reduzir retrabalho e preservar o contexto.',
    icon: MessageSquare,
  },
]

const START_STEPS = [
  { number: '01', title: 'Entendemos sua operação', text: 'Mapeamos a rotina do negócio e definimos a configuração inicial do ambiente.' },
  { number: '02', title: 'Organizamos o ambiente', text: 'Equipe, acessos e dados essenciais entram de forma estruturada para você começar com controle.' },
  { number: '03', title: 'Você entra em operação', text: 'O time passa a trabalhar no YuiSync com acompanhamento durante a implantação.' },
]

const TRUST_SIGNALS = [
  { icon: LayoutDashboard, title: 'Interface real', text: 'Produto demonstrado na página' },
  { icon: UsersRound, title: 'Implantação acompanhada', text: 'Configuração com contexto' },
  { icon: ShieldCheck, title: 'Acessos por função', text: 'Controle para cada equipe' },
  { icon: PawPrint, title: 'Disponível para petshops', text: 'Primeira solução vertical' },
]

const FAQS = [
  {
    question: 'O YuiSync é uma plataforma ou um sistema para petshops?',
    answer: 'O YuiSync é a plataforma de operação conectada. Petshops são a primeira solução vertical disponível, com fluxos próprios de agenda, clientes, pets, vendas e estoque.',
  },
  {
    question: 'O sistema inclui agenda, PDV e estoque?',
    answer: 'Sim. O YuiSync conecta os principais fluxos operacionais do petshop, incluindo agenda, vendas, estoque, clientes, pets e gestão de equipe.',
  },
  {
    question: 'Posso controlar o acesso da minha equipe?',
    answer: 'Sim. O YuiSync possui usuários, cargos e permissões para separar o que cada pessoa pode acessar.',
  },
  {
    question: 'Como funciona a contratação?',
    answer: 'Você escolhe o plano e passa por um onboarding guiado para preparar o ambiente antes de colocar a operação no sistema.',
  },
  {
    question: 'Consigo trazer dados que já tenho?',
    answer: 'Durante a implantação, avaliamos os cadastros e formatos disponíveis para organizar a entrada dos dados essenciais no novo ambiente.',
  },
  {
    question: 'Preciso instalar o YuiSync nos computadores?',
    answer: 'Não. O YuiSync funciona pela web e pode ser acessado em dispositivos compatíveis com navegador e conexão à internet.',
  },
  {
    question: 'Como o YuiSync trata privacidade e acessos?',
    answer: 'A plataforma separa usuários, cargos e permissões. O tratamento de dados e os canais para solicitações estão descritos na Política de Privacidade do YuiSync.',
  },
]

const DEMO_APPOINTMENTS = [
  ['09:00', 'Mel', 'Shih-tzu', 'Banho completo', 'Confirmado', 'R$ 55,00'],
  ['10:30', 'Thor', 'Golden Retriever', 'Banho + tosa', 'Agendado', 'R$ 120,00'],
  ['11:40', 'Nina', 'SRD', 'Consulta', 'Confirmado', 'R$ 180,00'],
]

function scrollToSection(id) {
  const target = document.getElementById(id)
  if (!target) return

  const scroller = target.closest('.public-home')
  const header = scroller?.querySelector('header')

  if (!scroller) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }

  const top = scroller.scrollTop
    + target.getBoundingClientRect().top
    - scroller.getBoundingClientRect().top
    - (header?.offsetHeight ?? 0)

  scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

function DemoKpi({ label, value, sub, icon: Icon, tone = 'emerald' }) {
  const tones = {
    emerald: 'text-emerald-500 bg-emerald-500/10',
    amber: 'text-amber-500 bg-amber-500/10',
    red: 'text-red-500 bg-red-500/10',
    violet: 'text-violet-500 bg-violet-500/10',
  }

  return (
    <div className="border border-white/[0.08] bg-[#171B24] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/40 sm:text-[9px]">{label}</p>
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${tones[tone]}`}>
          <Icon size={12} />
        </span>
      </div>
      <p className="mt-3 text-lg font-bold tracking-tight text-white sm:text-xl">{value}</p>
      <p className="mt-1 text-[9px] leading-4 text-white/42 sm:text-[10px]">{sub}</p>
    </div>
  )
}

function DesktopProductPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-10 -z-10 bg-[radial-gradient(circle_at_center,rgba(17,17,17,0.09),transparent_62%)]" />

      <div className="overflow-hidden border border-slate-200 bg-[#0F1219] shadow-[0_28px_90px_rgba(24,28,45,0.16)]">
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#11151D] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <YuiSyncMark inverted decorative className="h-5 w-5" />
            <div>
              <p className="text-[11px] font-bold leading-none text-white">YuiSync</p>
              <p className="mt-1 text-[9px] font-medium text-white/45">Operação para petshops</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[8px] font-semibold text-white/35">
            <span className="hidden sm:inline">Ambiente demonstrativo</span>
            <span className="h-6 w-6 rounded-md border border-white/10 bg-white/[0.04]" />
          </div>
        </div>

        <div className="grid min-h-[470px] grid-cols-[112px_1fr] bg-[#0F1219] sm:grid-cols-[145px_1fr]">
          <aside className="border-r border-white/[0.08] bg-[#11151D] px-2.5 py-4">
            <p className="mb-2.5 px-2 text-[7px] font-bold uppercase tracking-[0.18em] text-white/25 sm:text-[8px]">Menu principal</p>
            <div className="space-y-1 text-[9px] font-semibold sm:text-[10px]">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-2 py-2 text-emerald-400">
                <LayoutDashboard size={12} /> Dashboard
              </div>
              <div className="flex items-center gap-2 px-2 py-2 text-white/45"><CalendarDays size={12} /> Agenda</div>
              <div className="flex items-center gap-2 px-2 py-2 text-white/45"><ShoppingCart size={12} /> Vendas / PDV</div>
              <div className="flex items-center gap-2 px-2 py-2 text-white/45"><PawPrint size={12} /> Clientes & Pets</div>
              <div className="flex items-center gap-2 px-2 py-2 text-white/45"><Boxes size={12} /> Estoque</div>
            </div>

            <div className="mt-6 border-t border-white/[0.07] pt-3">
              <p className="px-2 text-[7px] font-bold uppercase tracking-[0.18em] text-white/20">Acesso</p>
              <div className="mt-2 flex items-center gap-2 px-2 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-[8px] font-bold text-emerald-400">G</span>
                <div className="min-w-0">
                  <p className="truncate text-[8px] font-semibold text-white/65">Gabriel</p>
                  <p className="text-[7px] text-white/25">Admin Pet</p>
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0 p-3 sm:p-4">
            <div className="mb-4">
              <h3 className="text-sm font-bold tracking-tight text-white sm:text-base">
                Bom dia! <span className="font-normal text-white/25">/ Dashboard</span>
              </h3>
              <p className="mt-1 text-[9px] text-white/40 sm:text-[10px]">terça-feira, 11 de agosto de 2026</p>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <DemoKpi label="Faturamento Hoje" value="R$ 4.280" sub="18 vendas · 3 upsells" icon={TrendingUp} />
              <DemoKpi label="Agendamentos Hoje" value="12" sub="8 pendentes · 4 concluídos" icon={CalendarDays} tone="amber" />
              <DemoKpi label="Estoque Crítico" value="3" sub="1 produto esgotado" icon={AlertTriangle} tone="red" />
              <DemoKpi label="Chats Ativos" value="4" sub="3 em atendimento automático" icon={MessageSquare} tone="violet" />
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-[1.55fr_0.75fr]">
              <div className="min-w-0 border border-white/[0.08] bg-[#171B24]">
                <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2.5">
                  <p className="text-[9px] font-bold text-white/75 sm:text-[10px]">Agenda de Hoje</p>
                  <span className="text-[7px] font-semibold text-amber-400 sm:text-[8px]">Ver tudo →</span>
                </div>
                <div className="overflow-hidden">
                  <div className="grid grid-cols-[38px_1fr_1.15fr_54px] border-b border-white/[0.06] px-3 py-2 text-[6px] font-bold uppercase tracking-wider text-white/20 sm:grid-cols-[42px_1fr_1.15fr_62px_56px] sm:text-[7px]">
                    <span>Hora</span><span>Pet</span><span>Serviço</span><span>Status</span><span className="hidden sm:block">Valor</span>
                  </div>
                  {DEMO_APPOINTMENTS.map(([time, pet, breed, service, status, price]) => (
                    <div key={`${time}-${pet}`} className="grid grid-cols-[38px_1fr_1.15fr_54px] items-center border-b border-white/[0.045] px-3 py-2 text-[7px] last:border-b-0 sm:grid-cols-[42px_1fr_1.15fr_62px_56px] sm:text-[8px]">
                      <span className="font-bold text-amber-400">{time}</span>
                      <span className="min-w-0"><strong className="block truncate font-semibold text-white/70">{pet}</strong><span className="block truncate text-[6px] text-white/25 sm:text-[7px]">{breed}</span></span>
                      <span className="truncate text-white/45">{service}</span>
                      <span className={`w-fit rounded px-1.5 py-1 text-[6px] font-bold ${status === 'Confirmado' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{status}</span>
                      <span className="hidden font-semibold text-emerald-400 sm:block">{price}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="hidden border border-white/[0.08] bg-[#171B24] lg:block">
                <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2.5">
                  <AlertTriangle size={11} className="text-amber-400" />
                  <p className="text-[9px] font-bold text-white/75">Estoque Crítico</p>
                </div>
                <div className="space-y-2 p-2.5">
                  {[
                    ['Shampoo Neutro 5L', '2 un', 'amber'],
                    ['Ração Premium 15kg', 'ESGOTADO', 'red'],
                    ['Tapete Higiênico', '4 un', 'amber'],
                  ].map(([name, stock, tone]) => (
                    <div key={name} className="border border-white/[0.06] bg-black/10 px-2.5 py-2">
                      <p className="truncate text-[8px] font-semibold text-white/60">{name}</p>
                      <p className={`mt-1 text-[7px] font-bold ${tone === 'red' ? 'text-red-400' : 'text-amber-400'}`}>{stock}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-2 border border-white/[0.08] bg-[#171B24] px-3 py-2.5">
              <p className="text-[8px] font-bold text-white/60">Ações Rápidas</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[7px] font-semibold">
                <span className="border border-white/10 px-2 py-1.5 text-white/45">+ Novo Agendamento</span>
                <span className="bg-emerald-600 px-2 py-1.5 text-white">Abrir PDV</span>
                <span className="border border-white/10 px-2 py-1.5 text-white/45">Cadastrar Pet</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-medium text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Interface real do YuiSync · dados demonstrativos
      </div>
    </div>
  )
}

const MOBILE_PREVIEW_TABS = [
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'venda', label: 'Venda', icon: ShoppingCart },
  { id: 'equipe', label: 'Equipe', icon: UsersRound },
]

function MobileProductPreview() {
  const [activeTab, setActiveTab] = useState('agenda')

  return (
    <div className="overflow-hidden border border-slate-200 bg-[#0F1219] shadow-[0_24px_65px_rgba(24,28,45,0.18)]">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#11151D] px-4 py-3.5">
        <div className="flex items-center gap-2.5"><YuiSyncMark inverted decorative className="h-6 w-6" /><div><p className="text-xs font-bold text-white">YuiSync</p><p className="text-[9px] text-white/45">Visualização adaptada</p></div></div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-white/45">Demo</span>
      </div>

      <div className="grid grid-cols-3 border-b border-white/[0.08] bg-[#11151D] p-2" role="tablist" aria-label="Áreas demonstradas do produto">
        {MOBILE_PREVIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[10px] font-bold transition-colors ${activeTab === tab.id ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}
          >
            <tab.icon size={12} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[360px] p-4 text-white">
        {activeTab === 'agenda' && (
          <div role="tabpanel">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/40">Hoje · 3 atendimentos</p>
            <h3 className="mt-2 text-xl font-bold">Agenda do dia</h3>
            <div className="mt-5 divide-y divide-white/[0.07] border-y border-white/[0.08]">
              {DEMO_APPOINTMENTS.map(([time, pet, breed, service, status]) => (
                <div key={`${time}-${pet}`} className="grid grid-cols-[46px_1fr_auto] items-center gap-3 py-3">
                  <span className="text-xs font-bold text-amber-400">{time}</span>
                  <span><strong className="block text-xs text-white">{pet} · {service}</strong><span className="mt-1 block text-[9px] text-white/38">{breed}</span></span>
                  <span className={`rounded px-2 py-1 text-[8px] font-bold ${status === 'Confirmado' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'venda' && (
          <div role="tabpanel">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/40">Venda #2481</p>
            <h3 className="mt-2 text-xl font-bold">Venda concluída</h3>
            <div className="mt-5 border border-white/[0.08] bg-[#171B24] p-4">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold">Banho + tosa</p><p className="mt-1 text-[10px] text-white/42">Thor · Golden Retriever</p></div><strong className="text-sm text-emerald-400">R$ 120,00</strong></div>
              <div className="mt-4 flex items-center gap-2 border-t border-white/[0.07] pt-4 text-[10px] text-white/60"><Boxes size={14} className="text-white/80" /> Produtos usados baixados do estoque</div>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.07] p-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400"><Check size={15} /></span><span><strong className="block text-xs">Gestão atualizada</strong><span className="text-[9px] text-white/40">A informação continua no mesmo fluxo.</span></span></div>
          </div>
        )}

        {activeTab === 'equipe' && (
          <div role="tabpanel">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/40">Controle operacional</p>
            <h3 className="mt-2 text-xl font-bold">Acessos por função</h3>
            <div className="mt-5 divide-y divide-white/[0.07] border-y border-white/[0.08]">
              {[
                ['Rafaela', 'Administrador', 'Todos os módulos'],
                ['Marina', 'Atendimento', 'Agenda · Clientes'],
                ['Lucas', 'Caixa', 'PDV · Estoque'],
              ].map(([name, role, access]) => (
                <div key={name} className="grid grid-cols-[1fr_auto] gap-3 py-3"><span><strong className="block text-xs">{name}</strong><span className="mt-1 block text-[9px] text-white/40">{role}</span></span><span className="self-center text-right text-[9px] font-semibold text-white/55">{access}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-white/[0.07] px-4 py-3 text-[9px] text-white/42"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Interface real · dados demonstrativos</div>
    </div>
  )
}

function ProductPreview() {
  return <><div className="hidden md:block"><DesktopProductPreview /></div><div className="md:hidden"><MobileProductPreview /></div></>
}

export default function PublicHomePageV2({ isAuthenticated = false }) {
  const entryHref = isAuthenticated ? '/' : '/entrar'
  const prefersReducedMotion = useReducedMotion()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const goToSection = (id) => {
    setMobileMenuOpen(false)
    requestAnimationFrame(() => scrollToSection(id))
  }

  return (
    <div className="public-home min-h-screen overflow-x-hidden bg-[#F5F5F3] text-[#111111]">
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#050505]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="YuiSync">
            <YuiSyncMark inverted className="h-8 w-8" />
            <span className="text-[16px] font-extrabold tracking-[-0.025em] text-white">YuiSync</span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-white/65 md:flex">
            <button type="button" onClick={() => scrollToSection('produto')} className="transition-colors hover:text-white">Plataforma</button>
            <button type="button" onClick={() => scrollToSection('recursos')} className="transition-colors hover:text-white">Recursos</button>
            <button type="button" onClick={() => scrollToSection('solucoes')} className="transition-colors hover:text-white">Soluções</button>
            <Link to="/vendas" className="transition-colors hover:text-white">Planos</Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link to={entryHref} className="hidden rounded-lg px-3.5 py-2 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.05] hover:text-white sm:inline-flex">
              {isAuthenticated ? 'Abrir painel' : 'Entrar'}
            </Link>
            <button type="button" aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} onClick={() => setMobileMenuOpen((open) => !open)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white/75 hover:bg-white/[0.06] hover:text-white md:hidden">{mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}</button>
            <a href={DEMO_HREF} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-white px-3.5 py-2.5 text-sm font-semibold text-black transition-transform hover:-translate-y-0.5 hover:bg-neutral-200 sm:px-4">
              <span className="min-[351px]:hidden">Demo</span><span className="hidden min-[351px]:inline sm:hidden">Agendar demo</span><span className="hidden sm:inline">Agendar demonstração</span> <ArrowRight size={14} />
            </a>
          </div>
        </div>
        {mobileMenuOpen && (
          <motion.nav id="mobile-navigation" initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="absolute inset-x-0 top-[72px] border-b border-white/10 bg-[#050505] px-5 py-4 shadow-2xl md:hidden">
            <div className="mx-auto grid max-w-7xl gap-1 text-sm font-semibold text-white/70">
              <button type="button" onClick={() => goToSection('produto')} className="rounded-lg px-3 py-3 text-left hover:bg-white/[0.06] hover:text-white">Plataforma</button>
              <button type="button" onClick={() => goToSection('recursos')} className="rounded-lg px-3 py-3 text-left hover:bg-white/[0.06] hover:text-white">Recursos</button>
              <button type="button" onClick={() => goToSection('solucoes')} className="rounded-lg px-3 py-3 text-left hover:bg-white/[0.06] hover:text-white">Soluções</button>
              <Link to="/vendas" onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-3 hover:bg-white/[0.06] hover:text-white">Planos</Link>
              <Link to={entryHref} onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-3 hover:bg-white/[0.06] hover:text-white">{isAuthenticated ? 'Abrir painel' : 'Entrar'}</Link>
            </div>
          </motion.nav>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#050505] text-white">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
          <div className="pointer-events-none absolute left-[-15%] top-[-30%] h-[620px] w-[620px] rounded-full bg-white/[0.035] blur-[130px]" />
          <div className="relative mx-auto grid min-h-[680px] max-w-7xl items-center gap-10 px-5 pb-16 pt-12 sm:px-8 md:pt-16 lg:min-h-[calc(100svh-72px)] lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:py-8">
            <motion.div
              className="relative z-10"
              variants={HERO_SEQUENCE}
              initial={prefersReducedMotion ? false : 'hidden'}
              animate="visible"
            >
              <motion.div variants={HERO_ITEM} transition={{ duration: 0.55 }} className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.45)]" /> Plataforma de operação conectada
              </motion.div>
              <motion.h1 variants={HERO_ITEM} transition={{ duration: 0.62 }} className="max-w-2xl text-[48px] font-extrabold leading-[0.98] tracking-[-0.055em] text-white sm:text-[60px] lg:text-[64px] xl:text-[68px]">
                Tudo em sincronia.
                <span className="block text-white/64">Seu negócio em movimento.</span>
              </motion.h1>
              <motion.p variants={HERO_ITEM} transition={{ duration: 0.58 }} className="mt-5 max-w-xl text-base leading-7 text-white/[0.68] sm:text-[17px] sm:leading-7">
                Conecte atendimento, clientes, agenda, vendas, estoque e equipe em uma única plataforma construída para acompanhar sua operação.
              </motion.p>
              <motion.div variants={HERO_ITEM} transition={{ duration: 0.55 }} className="mt-7 flex flex-wrap items-center gap-3">
                <a href={DEMO_HREF} className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-black transition-all hover:-translate-y-0.5 hover:bg-neutral-200">
                  Agendar demonstração <ArrowRight size={15} />
                </a>
                <button type="button" onClick={() => scrollToSection('produto')} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/[0.08]">
                  Ver o produto <ChevronRight size={15} />
                </button>
              </motion.div>
              <motion.div variants={HERO_ITEM} transition={{ duration: 0.55 }} className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-white/52">
                <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-white/70" /> Contexto compartilhado</span>
                <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-white/70" /> Controle de equipe</span>
                <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-white/70" /> Operação integrada</span>
              </motion.div>
            </motion.div>
            <ConnectionSphere />
          </div>
        </section>

        <section aria-label="Sinais de confiança do produto" className="border-t border-white/[0.08] bg-[#0A0A0A] text-white">
          <div className="mx-auto grid max-w-7xl divide-y divide-white/[0.08] px-5 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:px-8 lg:grid-cols-4">
            {TRUST_SIGNALS.map((signal) => (
              <div key={signal.title} className="flex items-center gap-3 py-5 sm:px-5 first:pl-0 last:pr-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/75"><signal.icon size={16} strokeWidth={1.8} /></span>
                <span><strong className="block text-xs font-bold text-white">{signal.title}</strong><span className="mt-0.5 block text-[11px] text-white/48">{signal.text}</span></span>
              </div>
            ))}
          </div>
        </section>

        <section id="produto" className="scroll-mt-[72px] mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-[72px]">
          <MotionReveal className="grid gap-14 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">Uma base. Vários fluxos.</p>
              <h2 className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-[#111111] sm:text-5xl">A operação inteira compartilha o mesmo contexto.</h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">No YuiSync, a informação entra onde o trabalho acontece e continua disponível para o próximo processo, para a próxima pessoa e para a gestão.</p>
          </MotionReveal>

          <MotionReveal className="mt-9" delay={0.08}><ProductPreview /></MotionReveal>

          <MotionReveal className="mt-8 grid overflow-hidden border border-slate-200 bg-white lg:grid-cols-3" delay={0.12}>
            <div className="p-7 transition-colors hover:bg-neutral-100 sm:p-8">
              <CalendarDays className="text-neutral-700" size={22} strokeWidth={1.8} />
              <h3 className="mt-5 text-xl font-bold tracking-tight">Conecte a operação</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">Processos e atendimentos organizados para cada etapa começar com o contexto da anterior.</p>
            </div>
            <div className="border-y border-slate-200 p-7 transition-colors hover:bg-neutral-100 sm:p-8 lg:border-x lg:border-y-0">
              <ShoppingCart className="text-neutral-700" size={22} strokeWidth={1.8} />
              <h3 className="mt-5 text-xl font-bold tracking-tight">Centralize a gestão</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">Dados operacionais reunidos para acompanhar o negócio sem consolidar planilhas manualmente.</p>
            </div>
            <div className="p-7 transition-colors hover:bg-neutral-100 sm:p-8">
              <UsersRound className="text-neutral-700" size={22} strokeWidth={1.8} />
              <h3 className="mt-5 text-xl font-bold tracking-tight">Evolua por solução</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">Uma plataforma comum que ganha fluxos específicos para cada tipo de operação atendida.</p>
            </div>
          </MotionReveal>
        </section>

        <PlatformGrid />

        <section id="recursos" className="scroll-mt-[72px] bg-[#090909] text-white">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-[72px]">
            <MotionReveal className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/58">Rotina real</p>
              <h2 className="mt-3 text-4xl font-extrabold leading-[1.06] tracking-[-0.04em] text-white sm:text-[46px]">Menos telas soltas. Mais operação conectada.</h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">O YuiSync organiza os pontos que mais geram perda de tempo no dia a dia, sem transformar tecnologia em complicação para a equipe.</p>
            </MotionReveal>
            <div className="mt-8 divide-y divide-white/10 border-y border-white/10">
              {BENEFITS.map((benefit, index) => (
                <MotionReveal key={benefit.eyebrow} delay={index * 0.06} distance={20}>
                  <article className="group grid gap-6 py-7 md:grid-cols-[170px_1fr_1fr] md:items-center">
                    <div className="flex items-center gap-3 text-sm font-semibold text-white/68 transition-colors group-hover:text-white"><benefit.icon size={18} className="text-white/78" strokeWidth={1.8} />{benefit.eyebrow}</div>
                    <h3 className="max-w-lg text-2xl font-bold leading-tight tracking-[-0.025em] text-white">{benefit.title}</h3>
                    <p className="max-w-lg text-sm leading-7 text-white/68">{benefit.text}</p>
                  </article>
                </MotionReveal>
              ))}
            </div>
          </div>
        </section>

        <section id="solucoes" className="scroll-mt-[72px] mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-[72px]">
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <MotionReveal>
              <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-600"><span className="h-1.5 w-1.5 rounded-full bg-neutral-900" /> Disponível agora</div>
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">Soluções sobre o YuiSync</p>
              <h2 className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] sm:text-5xl">YuiSync para petshops.</h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">A primeira solução vertical da plataforma conecta agenda, clientes, pets, PDV, estoque e equipe em uma rotina única.</p>
              <div className="mt-8 space-y-4 text-sm font-semibold text-slate-700">
                <div className="flex gap-3"><CalendarDays size={19} className="mt-0.5 shrink-0 text-neutral-700" /> Agenda e histórico no centro do atendimento.</div>
                <div className="flex gap-3"><ShoppingCart size={19} className="mt-0.5 shrink-0 text-neutral-700" /> PDV e estoque acompanhando a mesma operação.</div>
                <div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-neutral-700" /> Usuários, cargos e acessos separados por função.</div>
              </div>
            </MotionReveal>
            <MotionReveal className="border border-slate-200 bg-white p-6 shadow-[0_16px_50px_rgba(24,28,45,0.08)] sm:p-8" delay={0.1}>
              <div className="flex items-center justify-between border-b border-slate-200 pb-5">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Exemplo de permissões</p><p className="mt-1 text-xl font-bold tracking-tight">Acessos do petshop</p></div>
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">4 usuários</span>
              </div>
              {[
                ['Rafaela', 'Administrador', 'Todos os módulos'],
                ['Marina', 'Atendimento', 'Agenda · Clientes'],
                ['Lucas', 'Caixa', 'PDV · Estoque'],
                ['Ana', 'Banho & Tosa', 'Agenda'],
              ].map(([name, role, access], index) => (
                <div key={name} className={`grid grid-cols-[1fr_auto] gap-4 py-4 ${index ? 'border-t border-slate-100' : ''}`}>
                  <div><p className="text-sm font-bold text-slate-900">{name}</p><p className="mt-1 text-xs text-slate-500">{role}</p></div>
                  <p className="self-center text-right text-[11px] font-semibold text-slate-400">{access}</p>
                </div>
              ))}
            </MotionReveal>
          </div>
        </section>

        <section id="como-funciona" className="scroll-mt-[72px] border-y border-black/[0.06] bg-white">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
            <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
              <MotionReveal><p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">Implantação</p><h2 className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-[-0.04em]">Começar não precisa virar outro projeto dentro da empresa.</h2></MotionReveal>
              <MotionReveal className="divide-y divide-slate-200 border-y border-slate-200" delay={0.08}>
                {START_STEPS.map((step) => (
                  <div key={step.number} className="grid gap-4 py-7 sm:grid-cols-[52px_180px_1fr] sm:items-start">
                    <span className="text-xs font-bold tracking-[0.16em] text-slate-400">{step.number}</span><h3 className="text-base font-bold text-slate-900">{step.title}</h3><p className="text-sm leading-6 text-slate-600">{step.text}</p>
                  </div>
                ))}
              </MotionReveal>
            </div>
          </div>
        </section>

        <section id="confianca" className="scroll-mt-[72px] border-b border-black/[0.06] bg-[#EFEFEC]">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
            <MotionReveal className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
              <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">Confiança para operar</p><h2 className="mt-4 text-4xl font-extrabold leading-[1.06] tracking-[-0.04em]">Clareza antes, durante e depois da implantação.</h2></div>
              <p className="max-w-2xl text-base leading-7 text-slate-600">A proposta do YuiSync é reduzir incerteza: explicar como os dados são tratados, separar os acessos da equipe e acompanhar a entrada da operação no sistema.</p>
            </MotionReveal>
            <MotionReveal className="mt-10 grid overflow-hidden border border-slate-200 bg-white md:grid-cols-3" delay={0.08}>
              <Link to="/privacidade" className="group p-6 transition-colors hover:bg-neutral-100 sm:p-7"><ShieldCheck size={21} className="text-neutral-700" /><h3 className="mt-5 text-base font-bold">Privacidade documentada</h3><p className="mt-2 text-sm leading-6 text-slate-600">Política pública com finalidade de uso, compartilhamento e direitos do titular.</p><span className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-slate-800">Ler política <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></span></Link>
              <div className="border-y border-slate-200 p-6 sm:p-7 md:border-x md:border-y-0"><UsersRound size={21} className="text-neutral-700" /><h3 className="mt-5 text-base font-bold">Acessos separados</h3><p className="mt-2 text-sm leading-6 text-slate-600">Usuários, cargos e permissões ajudam cada pessoa a trabalhar no contexto correto.</p></div>
              <a href={DEMO_HREF} className="group p-6 transition-colors hover:bg-neutral-100 sm:p-7"><MessageSquare size={21} className="text-neutral-700" /><h3 className="mt-5 text-base font-bold">Conversa antes de contratar</h3><p className="mt-2 text-sm leading-6 text-slate-600">A demonstração ajuda a validar aderência, implantação e próximos passos.</p><span className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-slate-800">Agendar demonstração <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></span></a>
            </MotionReveal>
          </div>
        </section>

        <section id="faq" className="scroll-mt-[72px] mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:py-20">
          <MotionReveal className="text-center"><p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">Dúvidas frequentes</p><h2 className="mt-4 text-4xl font-extrabold tracking-[-0.04em]">Antes de começar.</h2></MotionReveal>
          <MotionReveal className="mt-12 divide-y divide-slate-200 border-y border-slate-200" delay={0.08}>
            {FAQS.map((faq) => (
              <details key={faq.question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-bold text-slate-900">{faq.question}<span className="text-xl font-normal text-slate-400 transition-transform group-open:rotate-45">+</span></summary><p className="max-w-3xl pb-1 pt-4 text-sm leading-7 text-slate-600">{faq.answer}</p></details>
            ))}
          </MotionReveal>
        </section>

        <section className="px-5 pb-8 sm:px-8">
          <MotionReveal className="mx-auto max-w-7xl overflow-hidden bg-[#090909] px-7 py-12 text-white sm:px-12 sm:py-14 lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div><YuiSyncMark animated inverted decorative className="h-11 w-11" /><h2 className="mt-7 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl">Sua operação pode trabalhar como um só sistema.</h2><p className="mt-5 max-w-xl text-base leading-7 text-white/60">Conheça o YuiSync e veja como conectar processos, pessoas e informação.</p></div>
            <div className="mt-9 flex flex-wrap gap-3 lg:mt-0"><a href={DEMO_HREF} className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-black">Agendar demonstração <ArrowRight size={15} /></a><Link to="/vendas" className="inline-flex items-center rounded-lg border border-white/20 px-5 py-3 text-sm font-bold text-white">Ver planos</Link></div>
          </MotionReveal>
        </section>
      </main>

      <footer className="border-t border-black/[0.07] bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm text-slate-500 sm:px-8 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <div className="flex items-center gap-2.5"><YuiSyncMark decorative className="h-7 w-7" /><span className="font-bold text-slate-800">YuiSync</span><span className="text-slate-300">•</span><span>yuisync.app</span></div>
            <p className="mt-3 max-w-md text-xs leading-5 text-slate-500">Plataforma de operação conectada. Agenda, clientes, vendas, estoque e equipe trabalhando com o mesmo contexto.</p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-xs font-semibold sm:grid-cols-3">
            <Link to="/vendas" className="hover:text-slate-900">Planos</Link>
            <button type="button" onClick={() => scrollToSection('faq')} className="text-left hover:text-slate-900">FAQ</button>
            <Link to={entryHref} className="hover:text-slate-900">{isAuthenticated ? 'Painel' : 'Entrar'}</Link>
            <Link to="/privacidade" className="hover:text-slate-900">Privacidade</Link>
            <Link to="/termos" className="hover:text-slate-900">Termos</Link>
            <a href={DEMO_HREF} className="hover:text-slate-900">Contato</a>
          </div>
        </div>
        <div className="mx-auto max-w-7xl border-t border-slate-100 px-5 py-4 text-[11px] text-slate-400 sm:px-8">© 2026 YuiSync. Todos os direitos reservados.</div>
      </footer>
    </div>
  )
}
