import { useCallback, useEffect, useState } from 'react'

import { getAppBootstrap } from '../../lib/api'
import { getAuthSession, signInWithPassword, signOutSession } from '../../lib/authApi'
import { canUseVisualPreview, isVisualPreviewSession, VISUAL_PREVIEW_KEY } from '../../lib/visualPreview'

const visualPreviewProfile = Object.freeze({
  id: 'visual-preview-user',
  email: 'preview@yuisync.local',
  full_name: 'Preview YuiSync',
  role: 'owner',
  active: true,
})

const visualPreviewTenant = Object.freeze({
  id: 'visual-preview-tenant',
  name: 'Ambiente de demonstração',
  slug: 'preview-local',
  role: 'owner',
  enabled_modules: ['petshop'],
  module_permissions: { petshop: 'admin_pet' },
})

function createVisualPreviewState() {
  const session = {
    user: { id: visualPreviewProfile.id, email: visualPreviewProfile.email },
    expiresAt: null,
    visualPreview: true,
  }
  const bootstrap = {
    profile: visualPreviewProfile,
    tenants: [visualPreviewTenant],
  }
  return { session, profile: visualPreviewProfile, bootstrap }
}

export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [bootstrap, setBootstrap] = useState(null)
  const [loading, setLoading] = useState(true)
  const [visualPreview, setVisualPreview] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      if (isVisualPreviewSession()) {
        const preview = createVisualPreviewState()
        setSession(preview.session)
        setProfile(preview.profile)
        setBootstrap(preview.bootstrap)
        setVisualPreview(true)
        return preview.bootstrap
      }

      setVisualPreview(false)
      const currentSession = await getAuthSession()
      if (!currentSession?.user?.id) {
        setSession(null)
        setProfile(null)
        setBootstrap(null)
        return null
      }

      const appBootstrap = await getAppBootstrap()
      if (!appBootstrap?.profile?.active) {
        await signOutSession().catch(() => {})
        setSession(null)
        setProfile(null)
        setBootstrap(null)
        throw new Error('Seu acesso esta desativado.')
      }

      setSession(currentSession)
      setProfile(appBootstrap.profile)
      setBootstrap(appBootstrap)
      return appBootstrap
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch((error) => {
      console.error('Erro ao carregar sessao:', error?.message || error)
      setSession(null)
      setProfile(null)
      setBootstrap(null)
      setLoading(false)
    })
  }, [refresh])

  const signIn = useCallback(async (email, password) => {
    const result = await signInWithPassword(email, password)
    if (result.error) return result

    try {
      await refresh()
      return result
    } catch (error) {
      await signOutSession().catch(() => {})
      return {
        data: { user: null, session: null },
        error: error instanceof Error ? error : new Error('Conta autenticada, mas sem acesso valido ao YuiSync.'),
      }
    }
  }, [refresh])

  const signInVisualPreview = useCallback(() => {
    if (!canUseVisualPreview()) {
      return { error: new Error('O modo visual está disponível apenas no ambiente local.') }
    }

    try {
      window.localStorage.setItem(VISUAL_PREVIEW_KEY, 'active')
    } catch {
      return { error: new Error('Não foi possível iniciar o modo visual neste navegador.') }
    }

    const preview = createVisualPreviewState()
    setSession(preview.session)
    setProfile(preview.profile)
    setBootstrap(preview.bootstrap)
    setVisualPreview(true)
    setLoading(false)
    return { data: preview, error: null }
  }, [])

  const signOut = useCallback(async () => {
    if (isVisualPreviewSession()) {
      try { window.localStorage.removeItem(VISUAL_PREVIEW_KEY) } catch { /* local preview only */ }
    } else {
      await signOutSession()
    }
    setSession(null)
    setProfile(null)
    setBootstrap(null)
    setVisualPreview(false)
  }, [])

  return {
    session,
    profile,
    bootstrap,
    loading,
    visualPreview,
    signIn,
    signInVisualPreview,
    signOut,
    refreshAuth: refresh,
  }
}
