import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  PawPrint,
  ShieldCheck,
  ShoppingCart,
  UsersRound,
} from 'lucide-react'

const PRODUCT_AREAS = [
  { icon: CalendarDays, label: 'Agenda' },
  { icon: ShoppingCart, label: 'PDV' },
  { icon: Boxes, label: 'Estoque' },
  { icon: PawPrint, label: 'Clientes & Pets' },
  { icon: UsersRound, label: 'Equipe' },
]

const BENEFITS = [
  {
    eyebrow: 'Agenda',
    title: 'Enxergue o dia inteiro sem depender de papel, planilha ou memória.',
    text: 'Atendimentos, horários e contexto do cliente ficam organizados em uma visão única para a equipe.',
    icon: CalendarDays,
  },
  {
    eyebrow: 'PDV + estoque',
    title: 'Venda com mais segurança e mantenha o estoque acompanhando a operação.',
    text: 'O caixa trabalha com o catálogo do sistema e as movimentações de estoque permanecem ligadas à venda.',
    icon: ShoppingCart,
  },
  {
    eyebrow: 'Clientes & pets',
    title: 'Histórico e cadastro no lugar em que sua equipe realmente trabalha.',
    text: 'Centralize informações importantes de clientes e pets para reduzir retrabalho e atendimento desencontrado.',
    icon: PawPrint,
  },
]

const START_STEPS = [
  {
    number: '01',
    title: 'Entendemos sua operação',
    text: 'Mapeamos a rotina do petshop e definimos a configuração inicial do ambiente.',
  },
  {
    number: '02',
    title: 'Organizamos o ambiente',
    text: 'Equipe, acessos e dados essenciais entram de forma estruturada para você começar com controle.',
  },
  {
    number: '03',
    title: 'Você entra em operação',
    text: 'O time passa a trabalhar no YuiSync com acompanhamento durante a implantação.',
  },
]

const FAQS = [
  {
    question: 'O YuiSync atende somente petshops?',
    answer: 'Hoje o produto está focado na operação de petshops. A plataforma foi estruturada para evoluir para outros módulos e segmentos sem comprometer o produto atual.',
  },
  {
    question: 'O sistema inclui agenda, PDV e estoque?',
    answer: 'Sim. O foco atual do YuiSync Next é conectar os principais fluxos operacionais do petshop, incluindo agenda, vendas, estoque, clientes, pets e gestão de equipe.',
  },
  {
    question: 'Posso controlar o acesso da minha equipe?',
    answer: 'Sim. O YuiSync Next possui usuários, cargos e permissões por empresa e módulo para separar o que cada pessoa pode acessar.',
  },
  {
    question: 'Como funciona a contratação?',
    answer: 'Você escolhe o plano e passa por um onboarding guiado para preparar o ambiente antes de colocar a operação no sistema.',
  },
]

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function ProductPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-8 -z-10 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(24,28,45,0.14)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/brand/yuisync-mark.png" alt="" className="h-5 w-5 object-contain" />
            <span className="text-xs font-bold tracking-tight text-slate-900">YuiSync</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-200" />
            <span className="h-2 w-2 rounded-full bg-slate-200" />
            <span className="h-2 w-2 rounded-full bg-slate-200" />
          </div>
        </div>

        <div className="grid min-h-[430px] grid-cols-[112px_1fr] bg-[#F8FAFC] sm:grid-cols-[138px_1fr]">
          <aside className="border-r border-slate-200 bg-[#10131B] px-3 py-4 text-white">
            <p className="mb-4 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">Petshop</p>
            <div className="space-y-1 text-[10px] sm:text-xs">
              <div className="rounded-lg bg-white/10 px-2.5 py-2 text-white">Visão geral</div>
              <div className="px-2.5 py-2 text-white/55">Agenda</div>
              <div className="px-2.5 py-2 text-white/55">PDV</div>
              <div className="px-2.5 py-2 text-white/55">Estoque</div>
              <div className="px-2.5 py-2 text-white/55">Clientes</div>
              <div className="px-2.5 py-2 text-white/55">Equipe</div>
            </div>
          </aside>

          <div className="p-4 sm:p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Hoje</p>
                <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-900">Visão geral</h3>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-500">
                Operação online
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="border border-slate-200 bg-white p-3">
                <p className="text-[10px] text-slate-500">Atendimentos</p>
                <p className="mt-1 text-xl font-bold text-slate-900">12</p>
                <p className="mt-2 text-[9px] font-medium text-emerald-600">8 confirmados</p>
              </div>
              <div className="border border-slate-200 bg-white p-3">
                <p className="text-[10px] text-slate-500">Vendas</p>
                <p className="mt-1 text-xl font-bold text-slate-900">R$ 4,2k</p>
                <p className="mt-2 text-[9px] font-medium text-slate-400">Resumo do dia</p>
              </div>
              <div className="col-span-2 border border-slate-200 bg-white p-3 sm:col-span-1">
                <p className="text-[10px] text-slate-500">Estoque</p>
                <p className="mt-1 text-xl font-bold text-slate-900">3</p>
                <p className="mt-2 text-[9px] font-medium text-amber-600">itens para revisar</p>
              </div>
            </div>

            <div className="mt-3 border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-900">Próximos atendimentos</p>
                  <p className="mt-0.5 text-[9px] text-slate-400">Agenda da equipe</p>
                </div>
                <span className="text-[9px] font-semibold text-blue-600">Ver agenda</span>
              </div>

              <div className="space-y-2">
                {[
                  ['09:30', 'Mel', 'Banho completo'],
                  ['10:20', 'Thor', 'Banho + tosa'],
                  ['11:00', 'Nina', 'Consulta'],
                ].map(([time, pet, service]) => (
                  <div key={`${time}-${pet}`} className="grid grid-cols-[42px_1fr] items-center gap-2 border-t border-slate-100 pt-2">
                    <span className="text-[9px] font-semibold text-slate-400">{time}</span>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold text-slate-800">{pet}</p>
                        <p className="text-[9px] text-slate-400">{service}</p>
                      </div>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-3 text-center text-[9px] text-slate-400">Prévia ilustrativa da experiência do produto</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PublicHomePage({ isAuthenticated = false }) {
  const entryHref = isAuthenticated ? '/' : '/entrar'

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F7F7F5] text-[#11131A]">
      <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#F7F7F5]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="YuiSync">
            <img src="/brand/yuisync-mark.png" alt="YuiSync" className="h-8 w-8 object-contain" />
            <div className="leading-none">
              <span className="block text-[15px] font-extrabold tracking-[-0.02em] text-[#151823]">YuiSync</span>
              <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">Next</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <button type="button" onClick={() => scrollToSection('produto')} className="transition-colors hover:text-slate-950">Produto</button>
            <button type="button" onClick={() => scrollToSection('recursos')} className="transition-colors hover:text-slate-950">Recursos</button>
            <button type="button" onClick={() => scrollToSection('como-funciona')} className="transition-colors hover:text-slate-950">Como funciona</button>
            <Link to="/vendas" className="transition-colors hover:text-slate-950">Planos</Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link to={entryHref} className="hidden rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-black/[0.04] sm:inline-flex">
              {isAuthenticated ? 'Abrir painel' : 'Entrar'}
            </Link>
            <Link to="/vendas" className="inline-flex items-center gap-1.5 rounded-lg bg-[#151823] px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">
              Conhecer
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 md:pt-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20 lg:pb-28">
          <div>
            <div className="mb-7 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              <span className="h-px w-8 bg-gradient-to-r from-cyan-500 to-violet-500" />
              Software para petshops
            </div>

            <h1 className="max-w-2xl text-[48px] font-extrabold leading-[0.98] tracking-[-0.055em] text-[#11131A] sm:text-[64px] lg:text-[74px]">
              Seu petshop.
              <span className="block bg-gradient-to-r from-[#07AEEA] via-[#2478F3] to-[#8B3FF6] bg-clip-text text-transparent">
                Sob controle.
              </span>
            </h1>

            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">
              Agenda, clientes, pets, estoque e vendas conectados em um único sistema para sua equipe trabalhar com menos retrabalho e mais clareza.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => scrollToSection('produto')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#151823] px-5 py-3 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-black"
              >
                Conhecer o YuiSync
                <ArrowRight size={15} />
              </button>
              <Link
                to="/vendas"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition-colors hover:border-slate-400"
              >
                Ver planos
                <ChevronRight size={15} />
              </Link>
            </div>

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Check size={13} /> Onboarding guiado</span>
              <span className="inline-flex items-center gap-1.5"><Check size={13} /> Controle de equipe</span>
              <span className="inline-flex items-center gap-1.5"><Check size={13} /> Operação integrada</span>
            </div>
          </div>

          <ProductPreview />
        </section>

        <section aria-label="Áreas do produto" className="border-y border-black/[0.06] bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-y divide-slate-200 px-5 sm:px-8 md:grid-cols-5 md:divide-y-0">
            {PRODUCT_AREAS.map((item) => (
              <div key={item.label} className="flex items-center justify-center gap-2.5 px-3 py-5 text-sm font-semibold text-slate-600">
                <item.icon size={16} strokeWidth={1.8} />
                {item.label}
              </div>
            ))}
          </div>
        </section>

        <section id="produto" className="scroll-mt-24 mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
          <div className="grid gap-14 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Um único fluxo</p>
              <h2 className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-[#11131A] sm:text-5xl">
                Da agenda ao caixa, sem trocar de sistema.
              </h2>
            </div>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              O YuiSync foi desenhado para a rotina de um petshop: a informação entra onde o trabalho acontece e continua disponível para quem precisa dela depois.
            </p>
          </div>

          <div className="mt-14 grid overflow-hidden border border-slate-200 bg-white lg:grid-cols-3">
            <div className="p-7 sm:p-9">
              <CalendarDays className="text-blue-600" size={22} strokeWidth={1.8} />
              <h3 className="mt-8 text-xl font-bold tracking-tight">Organize o dia</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">Agenda clara para acompanhar horários, serviços e o contexto de cada atendimento.</p>
            </div>
            <div className="border-y border-slate-200 p-7 sm:p-9 lg:border-x lg:border-y-0">
              <ShoppingCart className="text-violet-600" size={22} strokeWidth={1.8} />
              <h3 className="mt-8 text-xl font-bold tracking-tight">Venda com confiança</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">PDV conectado ao catálogo e à movimentação de estoque para reduzir divergências na operação.</p>
            </div>
            <div className="p-7 sm:p-9">
              <UsersRound className="text-cyan-600" size={22} strokeWidth={1.8} />
              <h3 className="mt-8 text-xl font-bold tracking-tight">Trabalhe em equipe</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">Usuários, cargos e acessos organizados para cada pessoa entrar no que realmente precisa.</p>
            </div>
          </div>
        </section>

        <section id="recursos" className="scroll-mt-24 bg-[#11131A] text-white">
          <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Rotina real</p>
              <h2 className="mt-4 text-4xl font-extrabold leading-[1.06] tracking-[-0.04em] text-white sm:text-5xl">
                Menos telas soltas. Mais operação conectada.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-white/60">
                Em vez de vender tecnologia pela tecnologia, o YuiSync organiza os pontos que mais geram perda de tempo no dia a dia.
              </p>
            </div>

            <div className="mt-16 divide-y divide-white/10 border-y border-white/10">
              {BENEFITS.map((benefit) => (
                <article key={benefit.eyebrow} className="grid gap-6 py-9 md:grid-cols-[170px_1fr_1fr] md:items-center">
                  <div className="flex items-center gap-3 text-sm font-semibold text-white/55">
                    <benefit.icon size={18} className="text-cyan-300" strokeWidth={1.8} />
                    {benefit.eyebrow}
                  </div>
                  <h3 className="max-w-lg text-2xl font-bold leading-tight tracking-[-0.025em] text-white">{benefit.title}</h3>
                  <p className="max-w-lg text-sm leading-7 text-white/55">{benefit.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Equipe & controle</p>
              <h2 className="mt-4 max-w-xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
                O sistema acompanha o crescimento da sua equipe.
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
                Crie usuários, organize responsabilidades e limite acessos por empresa e módulo sem compartilhar a mesma conta entre todo mundo.
              </p>

              <div className="mt-8 space-y-4 text-sm font-semibold text-slate-700">
                <div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-blue-600" /> Permissões e escopos validados pelo servidor.</div>
                <div className="flex gap-3"><UsersRound size={19} className="mt-0.5 shrink-0 text-violet-600" /> Usuários e cargos administrados no próprio YuiSync.</div>
                <div className="flex gap-3"><Clock3 size={19} className="mt-0.5 shrink-0 text-cyan-600" /> Implantação acompanhada para começar organizado.</div>
              </div>
            </div>

            <div className="border border-slate-200 bg-white p-6 shadow-[0_16px_50px_rgba(24,28,45,0.08)] sm:p-8">
              <div className="flex items-center justify-between border-b border-slate-200 pb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Equipe</p>
                  <p className="mt-1 text-xl font-bold tracking-tight">Acessos do petshop</p>
                </div>
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">5 usuários</span>
              </div>
              {[
                ['Rafaela', 'Administrador', 'Todos os módulos'],
                ['Marina', 'Atendimento', 'Agenda · Clientes'],
                ['Lucas', 'Caixa', 'PDV · Estoque'],
                ['Ana', 'Banho & Tosa', 'Agenda'],
              ].map(([name, role, access], index) => (
                <div key={name} className={`grid grid-cols-[1fr_auto] gap-4 py-4 ${index ? 'border-t border-slate-100' : ''}`}>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{name}</p>
                    <p className="mt-1 text-xs text-slate-500">{role}</p>
                  </div>
                  <p className="self-center text-right text-[11px] font-semibold text-slate-400">{access}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="scroll-mt-24 border-y border-black/[0.06] bg-white">
          <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Implantação</p>
                <h2 className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-[-0.04em]">
                  Começar não precisa virar outro projeto dentro da empresa.
                </h2>
              </div>

              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {START_STEPS.map((step) => (
                  <div key={step.number} className="grid gap-4 py-7 sm:grid-cols-[52px_180px_1fr] sm:items-start">
                    <span className="text-xs font-bold tracking-[0.16em] text-slate-400">{step.number}</span>
                    <h3 className="text-base font-bold text-slate-900">{step.title}</h3>
                    <p className="text-sm leading-6 text-slate-600">{step.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 mx-auto max-w-5xl px-5 py-24 sm:px-8 lg:py-28">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Dúvidas frequentes</p>
            <h2 className="mt-4 text-4xl font-extrabold tracking-[-0.04em]">Antes de começar.</h2>
          </div>

          <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-bold text-slate-900">
                  {faq.question}
                  <span className="text-xl font-normal text-slate-400 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-3xl pb-1 pt-4 text-sm leading-7 text-slate-600">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="px-5 pb-8 sm:px-8">
          <div className="mx-auto max-w-7xl overflow-hidden bg-[#151823] px-7 py-12 text-white sm:px-12 sm:py-14 lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div>
              <img src="/brand/yuisync-mark.png" alt="" className="h-11 w-11 object-contain" />
              <h2 className="mt-7 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-white sm:text-5xl">
                Seu petshop pode operar de um jeito mais simples.
              </h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-white/60">
                Conheça os planos e veja como colocar sua operação no YuiSync.
              </p>
            </div>

            <div className="mt-9 flex flex-wrap gap-3 lg:mt-0">
              <Link to="/vendas" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-[#151823]">
                Ver planos
                <ArrowRight size={15} />
              </Link>
              <Link to={entryHref} className="inline-flex items-center rounded-lg border border-white/20 px-5 py-3 text-sm font-bold text-white">
                {isAuthenticated ? 'Abrir painel' : 'Entrar'}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-9 text-sm text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/brand/yuisync-mark.png" alt="" className="h-6 w-6 object-contain" />
          <span className="font-bold text-slate-700">YuiSync</span>
          <span className="text-slate-300">•</span>
          <span>yuisync.app</span>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-xs font-semibold">
          <Link to="/vendas" className="hover:text-slate-900">Planos</Link>
          <button type="button" onClick={() => scrollToSection('faq')} className="hover:text-slate-900">FAQ</button>
          <Link to={entryHref} className="hover:text-slate-900">{isAuthenticated ? 'Painel' : 'Entrar'}</Link>
        </div>
      </footer>
    </div>
  )
}
