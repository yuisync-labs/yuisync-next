import { useCallback, useEffect, useState } from 'react'

import { getAppBootstrap } from '../../lib/api'
import { getAuthSession, signInWithPassword, signOutSession } from '../../lib/authApi'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [bootstrap, setBootstrap] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
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

  const signOut = useCallback(async () => {
    await signOutSession()
    setSession(null)
    setProfile(null)
    setBootstrap(null)
  }, [])

  return { session, profile, bootstrap, loading, signIn, signOut, refreshAuth: refresh }
}
