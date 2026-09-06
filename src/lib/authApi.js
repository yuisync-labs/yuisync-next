const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export async function passwordAction(action, values) {
  if (!['change-password', 'request-password-reset', 'reset-password'].includes(action)) throw new Error('Operação inválida.')
  const { response, payload } = await request(`/auth/${action}`, { method: 'POST', body: JSON.stringify(values) })
  if (!response.ok) {
    if (response.status === 429) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
    if (payload?.code === 'RECOVERY_UNAVAILABLE') throw new Error('Recuperação indisponível. Entre em contato com o suporte.')
    throw new Error(action === 'change-password' ? 'Não foi possível alterar a senha. Confira a senha atual.' : 'Não foi possível concluir. Confira os dados ou solicite um novo link.')
  }
  return payload
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

export async function getAuthSession() {
  const { response, payload } = await request('/auth/get-session', { method: 'GET' })
  if (response.status === 401 || response.status === 404) return null
  if (!response.ok) throw new Error(payload?.message || 'Nao foi possivel validar a sessao.')
  return payload?.session && payload?.user ? payload : null
}

export async function signInWithPassword(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const { response, payload } = await request('/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: normalizedEmail, password }),
  })

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error?.message || 'Email ou senha invalidos.')
    error.status = response.status
    error.code = payload?.code || payload?.error?.code || ''
    return { data: { user: null, session: null }, error }
  }
  return { data: payload, error: null }
}

export async function signOutSession() {
  const { response, payload } = await request('/auth/sign-out', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!response.ok) {
    const error = new Error(payload?.message || 'Nao foi possivel encerrar a sessao.')
    error.status = response.status
    throw error
  }
  return payload
}
