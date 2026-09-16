import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Clock3, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuthCtx } from '../../context/AuthContext'
import {
  activateCustomerOnboarding,
  claimCustomerOnboardingInvitation,
  getCustomerOnboardingStatus,
  inspectCustomerOnboardingInvitation,
  requestCustomerOnboardingInvitation,
} from '../../lib/api'
import YuiSyncMark from '../components/YuiSyncMark'

function messageFor(error) {
  if (error?.code === 'INVITATION_EXPIRED') return 'Este convite expirou. Volte ao comprovante da compra para solicitar um novo link.'
  if (error?.code === 'INVITATION_ACCOUNT_MISMATCH') return 'Este convite pertence a outro e-mail. Entre com a conta usada na compra.'
  if (error?.code === 'PAYMENT_NOT_CONFIRMED') return 'O pagamento ainda está sendo confirmado pela Stripe. Atualize esta página em alguns instantes.'
  if (error?.code === 'INVITATION_RATE_LIMITED' || error?.status === 429) return 'O link já foi enviado recentemente. Aguarde um minuto antes de reenviar.'
  if (error?.code === 'INVALID_PASSWORD') return 'Use pelo menos 12 caracteres, com letra maiúscula, minúscula e número.'
  return error?.message || 'Não foi possível concluir esta etapa. Tente novamente.'
}

export default function PublicWelcomePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { session, signIn, refreshTenants } = useAuthCtx()
  const sessionId = searchParams.get('session') || ''
  const token = searchParams.get('convite') || ''
  const [state, setState] = useState({ loading: true, mode: '', data: null, error: '' })
  const [passwords, setPasswords] = useState({ password: '', confirmation: '' })
  const [busy, setBusy] = useState(false)
  const nextPath = useMemo(() => `/boas-vindas?convite=${encodeURIComponent(token)}`, [token])

  useEffect(() => {
    let active = true
    async function load() {
      if (!sessionId && !token) {
        if (active) setState({ loading: false, mode: 'invalid', data: null, error: 'Abra o link recebido depois da compra.' })
        return
      }
      try {
        if (sessionId) {
          const status = await getCustomerOnboardingStatus(sessionId)
          if (status.payment === 'confirmed' && !status.activated) {
            await requestCustomerOnboardingInvitation(sessionId).catch(() => null)
          }
          if (active) setState({ loading: false, mode: 'return', data: status, error: '' })
          return
        }

        const invitation = await inspectCustomerOnboardingInvitation(token)
        if (!active) return
        setState({ loading: false, mode: 'invitation', data: invitation, error: '' })
        if (session?.user?.id) {
          setBusy(true)
          try {
            await claimCustomerOnboardingInvitation(token)
            await refreshTenants?.()
            navigate('/petshop/primeiros-passos', { replace: true })
          } catch (error) {
            if (active) setState((current) => ({ ...current, error: messageFor(error) }))
          } finally {
            if (active) setBusy(false)
          }
        }
      } catch (error) {
        if (active) setState({ loading: false, mode: token ? 'invitation' : 'return', data: null, error: messageFor(error) })
      }
    }
    load()
    return () => { active = false }
  }, [navigate, refreshTenants, session?.user?.id, sessionId, token])

  async function resend() {
    setBusy(true)
    setState((current) => ({ ...current, error: '' }))
    try {
      const result = await requestCustomerOnboardingInvitation(sessionId, { resend: true })
      setState((current) => ({ ...current, data: { ...current.data, email: result.email, invitation: 'pending' } }))
    } catch (error) {
      setState((current) => ({ ...current, error: messageFor(error) }))
    } finally {
      setBusy(false)
    }
  }

  async function activate(event) {
    event.preventDefault()
    if (passwords.password !== passwords.confirmation) {
      setState((current) => ({ ...current, error: 'As senhas não coincidem.' }))
      return
    }
    setBusy(true)
    setState((current) => ({ ...current, error: '' }))
    try {
      const result = await activateCustomerOnboarding(token, passwords.password)
      const login = await signIn(result.email, passwords.password)
      if (login?.error) throw login.error
      navigate('/petshop/primeiros-passos', { replace: true })
    } catch (error) {
      if (error?.code === 'ACCOUNT_EXISTS') {
        setState((current) => ({ ...current, data: { ...current.data, accountExists: true }, error: '' }))
      } else {
        setState((current) => ({ ...current, error: messageFor(error) }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-slate-950">
      <header className="border-b border-white/10 bg-[#090909] text-white">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5"><YuiSyncMark inverted className="h-8 w-8" /><strong>YuiSync</strong></Link>
          <div className="flex items-center gap-2 text-xs text-white/55"><ShieldCheck size={15} /> Ativação segura</div>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-72px)] max-w-6xl place-items-center px-5 py-12 sm:px-8">
        <section className="w-full max-w-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-10">
          {state.loading ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">Confirmando sua contratação…</div>
          ) : state.mode === 'return' && state.data ? (
            <div>
              {state.data.payment === 'confirmed' ? <CheckCircle2 className="text-emerald-600" size={34} /> : <Clock3 className="text-amber-600" size={34} />}
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Compra recebida</p>
              <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">{state.data.payment === 'confirmed' ? 'Vamos preparar seu YuiSync.' : 'Estamos confirmando o pagamento.'}</h1>
              <p className="mt-4 leading-7 text-slate-600">
                {state.data.payment === 'confirmed'
                  ? `Enviamos o acesso de ${state.data.businessName} para ${state.data.email}. Abra o e-mail para definir sua senha e iniciar a configuração.`
                  : 'A Stripe ainda está processando a assinatura. Esta etapa será liberada automaticamente após a confirmação.'}
              </p>
              {state.data.payment === 'confirmed' && !state.data.activated && (
                <button type="button" onClick={resend} disabled={busy} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">
                  <Mail size={16} /> {busy ? 'Enviando…' : 'Reenviar e-mail de acesso'}
                </button>
              )}
              {state.data.activated && <Link to="/entrar" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white">Entrar no YuiSync <ArrowRight size={16} /></Link>}
            </div>
          ) : state.mode === 'invitation' && state.data ? (
            <div>
              <KeyRound className="text-slate-700" size={32} />
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Primeiro acesso</p>
              <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">Ative {state.data.businessName}.</h1>
              <p className="mt-4 leading-7 text-slate-600">O acesso pertence a {state.data.email}. Depois da ativação, você seguirá para a configuração da empresa.</p>
              {busy && session?.user?.id ? (
                <p className="mt-7 text-sm font-semibold text-slate-600">Vinculando sua conta à empresa…</p>
              ) : state.data.accountExists ? (
                <Link to={`/entrar?next=${encodeURIComponent(nextPath)}`} className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white">Entrar com esta conta <ArrowRight size={16} /></Link>
              ) : (
                <form onSubmit={activate} className="mt-8 space-y-5">
                  <label className="block text-sm font-bold text-slate-700">Crie uma senha
                    <input type="password" required minLength={12} autoComplete="new-password" value={passwords.password} onChange={(event) => setPasswords((current) => ({ ...current, password: event.target.value }))} className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 px-3.5 outline-none focus:border-slate-950" />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">Repita a senha
                    <input type="password" required minLength={12} autoComplete="new-password" value={passwords.confirmation} onChange={(event) => setPasswords((current) => ({ ...current, confirmation: event.target.value }))} className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 px-3.5 outline-none focus:border-slate-950" />
                  </label>
                  <p className="text-xs leading-5 text-slate-500">Use 12 ou mais caracteres, com letra maiúscula, minúscula e número.</p>
                  <button disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white disabled:bg-slate-400">{busy ? 'Ativando…' : 'Ativar e configurar'} {!busy && <ArrowRight size={16} />}</button>
                </form>
              )}
            </div>
          ) : (
            <div><h1 className="text-2xl font-extrabold">Não foi possível abrir esta ativação.</h1><p className="mt-3 text-slate-600">{state.error}</p><Link to="/vendas" className="mt-6 inline-flex font-bold text-slate-950 underline">Voltar aos planos</Link></div>
          )}
          {state.error && state.data && <p role="alert" className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</p>}
        </section>
      </main>
    </div>
  )
}
