import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { passwordAction } from '../../lib/authApi'
import './LoginPage.css'

export default function AccountPasswordPage({ recovery = false }) {
  const [token] = useState(() => recovery ? new URLSearchParams(window.location.search).get('token') || '' : '')
  const [form, setForm] = useState({ email: '', currentPassword: '', newPassword: '', confirmation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const resetting = recovery && Boolean(token)
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [token])
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }))
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setError(''); setMessage('')
    if ((!recovery || resetting) && (form.newPassword !== form.confirmation || new TextEncoder().encode(form.newPassword).length > 72)) {
      setError('Confirme a mesma senha nos dois campos e use no máximo 72 bytes.'); return
    }
    setBusy(true)
    try {
      if (!recovery) {
        await passwordAction('change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword, revokeOtherSessions: true })
        setMessage('Senha alterada. As outras sessões foram encerradas.')
      } else if (resetting) {
        await passwordAction('reset-password', { token, newPassword: form.newPassword })
        setMessage('Senha redefinida. Entre novamente com sua nova senha.')
      } else {
        await passwordAction('request-password-reset', { email: form.email.trim().toLowerCase(), redirectTo: `${window.location.origin}/recuperar-senha` })
        setMessage('Se esse e-mail estiver cadastrado, você receberá um link válido por 15 minutos. Confira também o spam.')
      }
      setForm({ email: '', currentPassword: '', newPassword: '', confirmation: '' })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <main className="ys-account-shell">
    <section className="ys-account-card" aria-labelledby="account-title">
      <Link to={recovery ? '/entrar' : '/'} className="ys-account-back">← {recovery ? 'Voltar ao acesso' : 'Voltar ao YuiSync'}</Link>
      <h1 id="account-title">{recovery ? resetting ? 'Defina sua nova senha' : 'Recuperar acesso' : 'Minha conta'}</h1>
      <p>{recovery ? 'Recupere o acesso pelo e-mail da sua conta.' : 'Altere sua senha de acesso. A mudança encerra suas outras sessões.'}</p>
      <form className="ys-login-form" onSubmit={submit}>
        {recovery && !resetting ? <label className="ys-account-field">E-mail
          <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} disabled={busy} />
        </label> : <>
          {!recovery && <label className="ys-account-field">Senha atual
            <input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={set('currentPassword')} disabled={busy} />
          </label>}
          <label className="ys-account-field">Nova senha (pelo menos 12 caracteres)
            <input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={form.newPassword} onChange={set('newPassword')} disabled={busy} />
          </label>
          <label className="ys-account-field">Confirme a nova senha
            <input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={form.confirmation} onChange={set('confirmation')} disabled={busy} />
          </label>
        </>}
        {error && <p role="alert" className="ys-login-error">{error}</p>}
        {message && <p role="status" className="ys-account-success">{message}</p>}
        <button className="ys-login-submit" disabled={busy || (resetting && Boolean(message))}>{busy ? 'Aguarde…' : recovery && !resetting ? 'Enviar link de recuperação' : 'Salvar nova senha'}</button>
      </form>
    </section>
  </main>
}
