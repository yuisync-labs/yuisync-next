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
  const {
    activeTenantId,
    activePlanSlug,
    activePlanModules,
    hasPlanModule,
  } = useAuthCtx()
  return (
    <div>
      <output data-testid="active-tenant">{activeTenantId || 'none'}</output>
      <output data-testid="active-plan">{activePlanSlug || 'none'}</output>
      <output data-testid="active-plan-modules">{activePlanModules.join(',')}</output>
      <output data-testid="can-use-ai">{String(hasPlanModule('petbot_ai'))}</output>
    </div>
  )
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

  it('exposes normalized plan information for the active tenant', () => {
    authState = {
      ...authState,
      session: { user: { id: 'user-1' } },
      profile: { id: 'user-1', role: 'member' },
      bootstrap: {
        profile: { id: 'user-1', role: 'member' },
        tenants: [{
          id: 'tenant-prime',
          name: 'PetShop Prime',
          role: 'owner',
          enabled_modules: ['petshop'],
          module_permissions: { petshop: 'admin_pet' },
          plan_code: 'prime',
        }],
      },
      loading: false,
    }

    renderProvider()

    expect(screen.getByTestId('active-tenant')).toHaveTextContent('tenant-prime')
    expect(screen.getByTestId('active-plan')).toHaveTextContent('yui-prime-ia')
    expect(screen.getByTestId('active-plan-modules')).toHaveTextContent('petbot_ai')
    expect(screen.getByTestId('can-use-ai')).toHaveTextContent('true')
  })

  it('keeps legacy tenant access permissive when no commercial plan exists', () => {
    authState = {
      ...authState,
      session: { user: { id: 'user-1' } },
      profile: { id: 'user-1', role: 'member' },
      bootstrap: {
        profile: { id: 'user-1', role: 'member' },
        tenants: [{ id: 'tenant-legacy', name: 'PetShop Legado', enabled_modules: ['petshop'] }],
      },
      loading: false,
    }

    renderProvider()

    expect(screen.getByTestId('active-plan')).toHaveTextContent('none')
    expect(screen.getByTestId('active-plan-modules')).toHaveTextContent('')
    expect(screen.getByTestId('can-use-ai')).toHaveTextContent('true')
  })
})
