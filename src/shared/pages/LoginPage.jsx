import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { useAuthCtx } from '../../context/AuthContext'
import StarField from '../components/StarField'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const { signIn } = useAuthCtx()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    setLoading(true)

    try {
      const { error } = await signIn(form.email, form.password)
      if (error) throw error
      navigate('/', { replace: true })
    } catch (e) {
      setErr(e.message || 'Erro ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center font-body p-6 animate-fade-up relative overflow-hidden">
      <StarField count={150} />

      <div className="w-full max-w-md relative z-10">
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-6">
            <div className="absolute -inset-4 bg-blue-500/20 blur-2xl rounded-full" />
            <svg width="120" height="48" viewBox="0 0 100 40" fill="none" className="text-blue-500 relative overflow-visible">
              <circle cx="80" cy="20" r="14" fill="currentColor" className="opacity-10 animate-glow-soft" />
              <path d="M5 20 H80" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="opacity-20" />
              <path d="M5 20 H80" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="animate-neon-breath" />
              {[0, 1].map((i) => (
                <circle
                  key={i}
                  r="1.5"
                  fill="white"
                  className="animate-mote-shot"
                  style={{
                    offsetPath: "path('M5 20 H80')",
                    animationDelay: `${i * 1.2}s`,
                  }}
                />
              ))}
              {[0, 1, 2].map((i) => (
                <circle
                  key={i}
                  cx="80"
                  cy="20"
                  r="1.5"
                  fill="currentColor"
                  className="animate-particle"
                  style={{ animationDelay: `${i * 2.1}s` }}
                />
              ))}
              <circle cx="80" cy="20" r="8" stroke="currentColor" strokeWidth="2" fill="transparent" className="animate-pulse opacity-40 shadow-[0_0_15px_currentColor]" />
              <circle cx="80" cy="20" r="3" fill="white" className="animate-pulse shadow-[0_0_20px_white]" />
            </svg>
          </div>
          <h1 className="text-3xl font-display font-medium text-white tracking-[0.25em] uppercase">YUI Sync</h1>
          <p className="text-[#555555] text-[10px] font-bold uppercase tracking-[0.4em] mt-2">
            Automated Ecosystem
          </p>
        </div>

        <div className="bg-card border border-[var(--border)] rounded-xl3 p-8 shadow-card">
          <h2 className="font-display font-bold text-lg text-text mb-1">Acessar Conta</h2>
          <p className="text-muted text-sm mb-6">Digite suas credenciais abaixo</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="inp-label" htmlFor="login-email">E-mail</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="login-email"
                  name="email"
                  autoComplete="email"
                  className="inp pl-9"
                  type="email"
                  placeholder="seu@email.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="inp-label" htmlFor="login-password">Senha</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  className="inp pl-9 pr-10"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {err && (
              <p role="alert" className="text-sm rounded-xl px-3.5 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20">
                {err}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full justify-center py-2.5 mt-2 bg-text text-bg hover:bg-gray-300 font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? 'Conectando...' : 'Entrar na Plataforma'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-[var(--border2)] text-center">
            <p className="text-sm text-muted">Novos acessos são criados pelo administrador da plataforma.</p>
          </div>
        </div>

        <p className="text-center text-xs text-muted/50 mt-6">
          SaaS Multi-tenant • Better Auth
        </p>
      </div>
    </div>
  )
}
