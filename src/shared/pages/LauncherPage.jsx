import { useState, useEffect } from 'react'
import { MODULES } from '../../config/modules'
import { useAuthCtx } from '../../context/AuthContext'
import { useModuleCtx } from '../../context/ModuleContext'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, LogOut, Shield } from 'lucide-react'
import StarField from '../components/StarField'
import YuiSyncMark from '../../public/components/YuiSyncMark'

// Uma página sem Sidebar, que apenas mostra os "Apps" que o usuário tem acesso.
export default function LauncherPage() {
  const { profile, signOut, tenantEnabledModules = [] } = useAuthCtx()
  const { setActiveModuleId } = useModuleCtx()
  const navigate = useNavigate()

  // Se o usuário tem allowed_modules no banco, nós filtramos as chaves disponíveis.
  // Se for admin, ou se allowed_modules for vazio/inexistente por legado, assume que tem acesso a tudo (ou fallback adequado).
  const isAdmin = profile?.role === 'admin'
  const allowed = profile?.allowed_modules || []
  const tenantModules = tenantEnabledModules.length > 0 ? tenantEnabledModules : ['petshop']

  const modulesList = Object.values(MODULES).filter(m => {
    if (m.id === 'system') return isAdmin
    if (!tenantModules.includes(m.id)) return false
    if (isAdmin) return true
    if (allowed.length === 0) return m.id === 'petshop' // fallback legado: quem não tem array, vê petshop
    return allowed.includes(m.id)
  })

  // No momento que o Launcher monta, limpamos qualquer módulo ativo 
  // para garantir que o usuário não seja "puxado" por estados antigos.
  useEffect(() => {
    setActiveModuleId(null)
  }, [setActiveModuleId])

  // Lógica de redirecionamento automático REMOVIDA. 
  // Agora todos os usuários (Admin e Funcionário) passam pelo Hub para ver seu app disponível.

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center font-body p-6 animate-fade-up relative overflow-hidden">
      <StarField />

      <div className="w-full max-w-5xl relative z-10">
        <div className="text-center mb-10 animate-in fade-in slide-in-from-top-10 duration-1000">
          <div className="relative mb-6 flex justify-center">
             <div className="absolute -inset-8 rounded-full bg-white/[0.04] blur-3xl" />
             <YuiSyncMark animated inverted orbit decorative className="relative h-24 w-24" />
          </div>
          <h1 className="mb-3 font-display text-3xl font-black tracking-[-0.045em] text-white md:text-4xl">YuiSync</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-muted">Central de operações conectadas</p>
        </div>

        {/* Business Modules - Layout Flex otimizado para horizontalidade */}
        <div className="flex flex-col md:flex-row flex-wrap items-center justify-center gap-6 mb-12 w-full">
          {modulesList.filter(m => m.id !== 'system').map(m => {
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => navigate(`/${m.id}`)}
                className="group relative bg-[var(--surface)] border border-[var(--border2)] rounded-[28px] p-8 text-left overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:border-blue-500/30 w-full md:w-[320px] shadow-2xl flex flex-col"
              >
                <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 ${m.theme.primaryBg}`} />
                <div className="relative z-10 flex items-start justify-between">
                  <div className={`w-14 h-14 rounded-2xl ${m.theme.primaryBg} flex items-center justify-center ${m.theme.shadow} mb-6 text-gray-950`}>
                    <Icon size={28} />
                  </div>
                  <div className="w-8 h-8 rounded-full border border-white/5 flex items-center justify-center text-muted group-hover:text-text group-hover:border-white/10 transition-all">
                    <ArrowRight size={16} />
                  </div>
                </div>
                <h3 className="text-xl font-display font-black text-white mb-1 uppercase tracking-wide">{m.name}</h3>
                <p className="text-muted text-[11px] font-medium leading-relaxed">{m.description}</p>
              </button>
            )
          })}
        </div>

        {/* Global Admin Tools - Proporcional */}
        {isAdmin && modulesList.some(m => m.id === 'system') && (
          <div className="flex flex-col items-center border-t border-white/5 pt-10">
            <p className="text-[9px] font-black text-muted uppercase tracking-[0.4em] mb-6">Ferramentas Master</p>
            <button
               onClick={() => navigate('/system')}
               className="group flex items-center gap-5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-violet-500/30 rounded-2xl p-5 transition-all duration-300 w-full max-w-sm"
            >
              <div className="w-10 h-10 rounded-xl bg-violet-600/10 flex items-center justify-center text-violet-400 group-hover:bg-violet-600 group-hover:text-white transition-all duration-300">
                <Shield size={20} />
              </div>
              <div className="flex-1 text-left">
                 <h4 className="font-display font-black text-white uppercase tracking-wider text-sm">Usuários e Permissões</h4>
                 <p className="text-[9px] text-muted font-bold">Controle global de acessos da plataforma</p>
              </div>
              <ArrowRight size={16} className="text-muted group-hover:text-text group-hover:translate-x-1 transition-all" />
            </button>
          </div>
        )}

        <div className="text-center mt-10">
          <button onClick={signOut} className="text-muted hover:text-red-400 text-[11px] font-bold uppercase tracking-widest flex items-center gap-2 mx-auto transition-colors group">
            <LogOut size={14} className="group-hover:rotate-12 transition-transform" /> Sair da conta
          </button>
        </div>
      </div>
    </div>
  )
}
