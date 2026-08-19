import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import YuiSyncMark from '../public/components/YuiSyncMark'

export function LoadingScreen() {
  useEffect(() => {
    document.body.classList.add('app-loading')
    document.body.setAttribute('aria-busy', 'true')

    return () => {
      document.body.classList.remove('app-loading')
      document.body.removeAttribute('aria-busy')
    }
  }, [])

  return createPortal(
    <div
      className="yui-loading-portal fixed inset-0 z-[9999] flex min-h-screen items-center justify-center overflow-hidden bg-[#070707]"
      role="status"
      aria-live="polite"
      aria-label="Carregando aplicacao"
    >
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="absolute h-[360px] w-[760px] rotate-[-12deg] rounded-[50%] border border-white/[0.06]" />
      <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-700">
        <YuiSyncMark animated inverted orbit decorative className="h-24 w-24" />
        <h1 className="mt-7 font-display text-2xl font-extrabold tracking-[-0.04em] text-white">YuiSync</h1>
        <div className="mt-4 flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]" />
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Sincronizando ambiente</p>
        </div>
      </div>
    </div>,
    document.body
  )
}
