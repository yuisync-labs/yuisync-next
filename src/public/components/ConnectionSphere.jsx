import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CalendarCheck, PackageCheck, ShoppingBag } from 'lucide-react'

const ParticleSphere = lazy(() => import('../../components/originkit/ui/particlesphere'))

const EVENTS = [
  {
    className: 'left-0 top-[16%] sm:-left-4',
    icon: CalendarCheck,
    label: 'Agenda sincronizada',
    detail: 'Novo atendimento · agora',
  },
  {
    className: 'right-0 top-[42%] sm:-right-2',
    icon: ShoppingBag,
    label: 'Venda concluída',
    detail: 'Estoque atualizado',
  },
  {
    className: 'bottom-[7%] left-[8%]',
    mobileHidden: true,
    icon: PackageCheck,
    label: 'Operação conectada',
    detail: 'Todos os módulos online',
  },
]

function EventCard({ event, index, reducedMotion }) {
  const Icon = event.icon

  return (
    <motion.div
      className={`pointer-events-none absolute z-20 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#101010]/90 px-3 py-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-md ${event.mobileHidden ? 'hidden sm:flex' : ''} ${event.className}`}
      initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: reducedMotion ? 0 : [0, index % 2 ? -5 : 5, 0], scale: 1 }}
      transition={{
        opacity: { delay: 0.6 + index * 0.15, duration: 0.5 },
        scale: { delay: 0.6 + index * 0.15, duration: 0.5 },
        y: reducedMotion
          ? { duration: 0 }
          : { delay: 1.1 + index * 0.2, duration: 5 + index, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/75">
        <Icon size={14} strokeWidth={1.8} />
      </span>
      <span className="min-w-0">
        <strong className="block whitespace-nowrap text-[10px] font-semibold text-white sm:text-[11px]">{event.label}</strong>
        <span className="block whitespace-nowrap text-[8px] text-white/40 sm:text-[9px]">{event.detail}</span>
      </span>
    </motion.div>
  )
}

export default function ConnectionSphere() {
  const prefersReducedMotion = useReducedMotion()
  const sphereRef = useRef(null)
  const [isMobile, setIsMobile] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const element = sphereRef.current
    if (!element || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { rootMargin: '220px 0px', threshold: 0.01 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      ref={sphereRef}
      className="relative mx-auto aspect-square w-full max-w-[590px] lg:max-w-[540px] xl:max-w-[560px]"
      aria-label="Esfera de partículas representando os módulos conectados do YuiSync"
      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="pointer-events-none absolute inset-[8%] rounded-full bg-white/[0.055] blur-3xl" />
      <div className="absolute inset-[2%] z-10">
        {isVisible && (
          <Suspense fallback={<div className="h-full w-full rounded-full bg-white/[0.035] blur-2xl" />}>
            <ParticleSphere
              particlesCount={isMobile ? 2600 : 6500}
              particleScale={isMobile ? 2.5 : 2.8}
              speed={prefersReducedMotion ? -1.25 : 3}
              smoothing={8}
              scale={9.5}
              stopOnHover={false}
              rotationDirection="clockwise"
              dragSpeed={3}
              drag={!prefersReducedMotion && !isMobile}
              cursorOn={!prefersReducedMotion && !isMobile}
              cursorRadiusUI={92}
              cursorStrengthUI={2}
              clickForce={1.5}
              sphereColor="#FFFFFF"
              style={{ width: '100%', height: '100%' }}
            />
          </Suspense>
        )}
      </div>

      {EVENTS.map((event, index) => (
        <EventCard key={event.label} event={event} index={index} reducedMotion={prefersReducedMotion} />
      ))}
    </motion.div>
  )
}
