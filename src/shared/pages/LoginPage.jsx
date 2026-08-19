import { useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuthCtx } from '../../context/AuthContext'
import YuiSyncMark from '../../public/components/YuiSyncMark'
import './LoginPage.css'

export default function LoginPage() {
  const { signIn, signInVisualPreview } = useAuthCtx()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  async function handleSubmit(event) {
    event.preventDefault()
    setErr('')
    setLoading(true)

    try {
      const { error } = await signIn(form.email, form.password)
      if (error) throw error
      navigate('/', { replace: true })
    } catch (error) {
      setErr(error.message || 'Erro ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  function handleVisualPreview() {
    setErr('')
    const result = signInVisualPreview?.()
    if (result?.error) {
      setErr(result.error.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="ys-login-shell">
      <section className="ys-login-brand" aria-label="YuiSync, plataforma de operação conectada">
        <Link to="/" className="ys-login-wordmark" aria-label="Voltar para a página inicial do YuiSync">
          <YuiSyncMark inverted decorative className="ys-login-wordmark-mark" />
          <span>YuiSync</span>
        </Link>

        <div className="ys-login-orbit ys-login-orbit--one" aria-hidden="true" />
        <div className="ys-login-orbit ys-login-orbit--two" aria-hidden="true" />

        <div className="ys-login-brand-copy">
          <YuiSyncMark animated inverted orbit decorative className="ys-login-brand-mark" />
          <h1>Sua operação continua em movimento.</h1>
          <p>Agenda, equipe, vendas e estoque permanecem conectados enquanto o trabalho acontece.</p>
          <div className="ys-login-status">
            <span aria-hidden="true" />
            Conexão segura com seu ambiente
          </div>
        </div>
      </section>

      <main className="ys-login-panel">
        <Link to="/" className="ys-login-back">
          <ArrowLeft size={15} /> Voltar ao site
        </Link>

        <div className="ys-login-form-wrap">
          <div className="ys-login-mobile-brand" aria-hidden="true">
            <YuiSyncMark className="ys-login-mobile-mark" decorative />
            <strong>YuiSync</strong>
          </div>

          <p className="ys-login-kicker">Acesso ao ambiente</p>
          <h2>Bem-vindo de volta.</h2>
          <p className="ys-login-subtitle">Entre para acompanhar sua agenda, equipe e operação em um só lugar.</p>

          <form onSubmit={handleSubmit} className="ys-login-form">
            <div className="ys-login-field">
              <label htmlFor="login-email">E-mail</label>
              <div className="ys-login-input-wrap">
                <Mail size={17} aria-hidden="true" />
                <input
                  id="login-email"
                  name="email"
                  autoComplete="email"
                  type="email"
                  placeholder="voce@empresa.com.br"
                  value={form.email}
                  onChange={(event) => set('email', event.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="ys-login-field">
              <label htmlFor="login-password">Senha</label>
              <div className="ys-login-input-wrap">
                <Lock size={17} aria-hidden="true" />
                <input
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setShowPw((current) => !current)}
                  className="ys-login-password-toggle"
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {err && <p role="alert" className="ys-login-error">{err}</p>}

            <button type="submit" disabled={loading} className="ys-login-submit">
              <span>{loading ? 'Conectando...' : 'Entrar no YuiSync'}</span>
              {!loading && <ArrowRight size={17} aria-hidden="true" />}
            </button>

            {import.meta.env.DEV && (
              <button type="button" onClick={handleVisualPreview} className="ys-login-preview">
                <span>Explorar interface local</span>
                <span className="ys-login-preview-badge">DEV</span>
              </button>
            )}
          </form>

          <p className="ys-login-access-note">Novos acessos são criados pelo administrador da sua empresa.</p>
        </div>

        <div className="ys-login-legal">
          <span>© 2026 YuiSync</span>
          <span aria-hidden="true">·</span>
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos</Link>
        </div>
      </main>
    </div>
  )
}
