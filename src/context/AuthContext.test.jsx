import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider, useAuthCtx } from './AuthContext'

const refreshAuth = vi.fn()
let authState

vi.mock('../shared/hooks/useAuth', () => ({
  useAuth: () => authState,
}))

vi.mock('../lib/api', () => ({
  createAppTenant: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({ settings: {} }),
}))

function Probe() {
  const { activeTenantId } = useAuthCtx()
  return <output data-testid="active-tenant">{activeTenantId || 'none'}</output>
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={['/petshop/agenda']}>
      <AuthProvider><Probe /></AuthProvider>
    </MemoryRouter>,
  )
}

describe('AuthProvider tenant persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    refreshAuth.mockReset()
    authState = {
      session: null,
      profile: null,
      bootstrap: null,
      loading: true,
      visualPreview: false,
      refreshAuth,
    }
  })

  it('preserves the stored tenant while auth bootstraps after a direct page load', () => {
    localStorage.setItem('@yui_active_tenant', 'tenant-qa')
    const view = renderProvider()

    expect(localStorage.getItem('@yui_active_tenant')).toBe('tenant-qa')
    expect(screen.getByTestId('active-tenant')).toHaveTextContent('none')

    authState = {
      ...authState,
      session: { user: { id: 'user-1' } },
      profile: { id: 'user-1', role: 'admin' },
      bootstrap: {
        profile: { id: 'user-1', role: 'admin' },
        tenants: [
          { id: 'tenant-first', name: 'PetShop QuatroPatas', enabled_modules: ['petshop'] },
          { id: 'tenant-qa', name: 'YuiSync QA', enabled_modules: ['petshop'] },
        ],
      },
      loading: false,
    }
    view.rerender(
      <MemoryRouter initialEntries={['/petshop/agenda']}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('active-tenant')).toHaveTextContent('tenant-qa')
    expect(localStorage.getItem('@yui_active_tenant')).toBe('tenant-qa')
  })
})
