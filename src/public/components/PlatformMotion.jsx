import { lazy, Suspense } from 'react'

const InteractiveGrid = lazy(() => import('../../components/originkit/ui/interactive-grid'))

function svgMark(label, detail, paths) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 78"><g transform="translate(14 22)" fill="none" stroke="#d4d4d4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g><text x="58" y="34" fill="#f5f5f5" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="650">${label}</text><text x="58" y="53" fill="#8a8a8a" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="500">${detail}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const MODULE_IMAGES = [
  svgMark('Agenda', 'atendimento criado', '<rect x="2" y="4" width="26" height="24" rx="4"/><path d="M8 1v6M22 1v6M2 11h26M9 17h3M16 17h3M9 22h3"/>'),
  svgMark('Relacionamento', 'histórico compartilhado', '<circle cx="11" cy="10" r="5"/><circle cx="23" cy="12" r="4"/><path d="M2 28c1-7 5-10 10-10s9 3 10 10M20 20c5 0 8 3 9 8"/>'),
  svgMark('Vendas', 'estoque atualizado', '<path d="M5 9h22l-2 19H7L5 9Z"/><path d="M10 10V7a6 6 0 0 1 12 0v3M11 18h10"/>'),
  svgMark('Estoque', 'alerta em tempo real', '<path d="m16 2 13 7-13 7L3 9l13-7Z"/><path d="m3 9 13 7 13-7v14l-13 7-13-7V9ZM16 16v14"/>'),
  svgMark('Equipe', 'acesso por função', '<circle cx="16" cy="8" r="5"/><circle cx="5" cy="12" r="3"/><circle cx="27" cy="12" r="3"/><path d="M7 29c1-8 4-11 9-11s8 3 9 11M0 28c0-6 2-9 6-9M32 28c0-6-2-9-6-9"/>'),
  svgMark('Automação', 'rotinas sem retrabalho', '<path d="M18 2 7 17h8l-1 13 11-16h-8l1-12Z"/>'),
]

const GRID_PROPS = {
  images: MODULE_IMAGES,
  gap: 8,
  rounded: 12,
  logoScale: 3.55,
  cardFill: '#101010',
  cardBorder: 'rgba(255,255,255,0.09)',
  shadow: false,
  glow: true,
  glowStart: 'rgba(255,255,255,0.14)',
  glowEnd: '#FFFFFF',
  glowIntensity: 15,
  perspective: 1400,
  rotateX: 0,
  rotateY: 0,
}

function GridFallback() {
  return <div className="h-full w-full animate-pulse rounded-xl bg-white/[0.03]" />
}

export function PlatformGrid() {
  return (
    <section aria-label="Módulos conectados do YuiSync" className="border-y border-white/[0.07] bg-[#080808] text-white">
      <div className="mx-auto max-w-7xl px-5 pb-4 pt-8 sm:px-8 sm:pt-10">
        <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Um evento. O mesmo contexto.</p><h2 className="mt-2 text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">Veja a informação percorrer a operação.</h2></div>
          <p className="max-w-xl text-sm leading-6 text-white/58">Agendamento criado <span className="mx-1 text-white/30">→</span> atendimento realizado <span className="mx-1 text-white/30">→</span> venda concluída <span className="mx-1 text-white/30">→</span> estoque atualizado.</p>
        </div>
        <Suspense fallback={<GridFallback />}>
          <div className="mt-4 hidden h-[132px] md:block">
            <InteractiveGrid {...GRID_PROPS} padding="8px" columns={6} rows={1} />
          </div>
          <div className="mt-4 h-[330px] md:hidden">
            <InteractiveGrid {...GRID_PROPS} padding="8px" columns={2} rows={3} />
          </div>
        </Suspense>
      </div>
    </section>
  )
}
