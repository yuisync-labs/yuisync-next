import React, { Suspense, lazy, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useAuthCtx } from '../context/AuthContext'
import { useModuleCtx } from '../context/ModuleContext'
import { usePerformanceCtx } from '../context/PerformanceContext'
import StarField from '../shared/components/StarField'
import { LoadingScreen } from '../components/LoadingScreen'
import { Sidebar } from '../components/Sidebar'
import { SupportWidget } from '../components/SupportWidget'
import { SystemSupportPriorityAlert } from '../components/SystemSupportPriorityAlert'
import { RouteErrorBoundary } from '../components/RouteErrorBoundary'
import { LoadingState } from '../components/PageState'
import { PerformanceModeButton } from '../components/PerformanceModeButton'
import { ProductPageSurface } from '../components/ui'
import { PetshopOperationsEnhancer } from '../modules/petshop/components/PetshopOperationsEnhancer'
import { AgendaCardLayoutEnhancer } from '../modules/petshop/components/AgendaCardLayoutEnhancer'
import { PackageRecurringScheduleEnhancer } from '../modules/petshop/components/PackageRecurringScheduleEnhancer'
import { DashboardAgendaLabelsEnhancer } from '../modules/petshop/components/DashboardAgendaLabelsEnhancer'

const LoginPage = lazy(() => import('../shared/pages/LoginPage'))
const AccountPasswordPage = lazy(() => import('../shared/pages/AccountPasswordPage'))
const LauncherPage = lazy(() => import('../shared/pages/LauncherPage'))
const PublicHomePage = lazy(() => import('../public/pages/PublicHomePage'))
const PublicSalesPage = lazy(() => import('../public/pages/PublicSalesPage'))
const PublicCheckoutPage = lazy(() => import('../public/pages/PublicCheckoutPage'))
const PublicBookingPage = lazy(() => import('../public/pages/PublicBookingPage'))
const PublicClientPortalPage = lazy(() => import('../public/pages/PublicClientPortalPage'))
const PublicLegalPage = lazy(() => import('../public/pages/PublicLegalPage'))

function getModuleNavItems(activeModule) {
  if (!activeModule) return []
  if (Array.isArray(activeModule.navSections) && activeModule.navSections.length > 0) {
    return activeModule.navSections.flatMap((section) => section?.items || [])
  }
  return [
    ...(activeModule.nav || []),
    ...(activeModule.adminNav || []),
  ]
}

function getAccessiblePages(activeModule, profile) {
  if (!activeModule) return []
  const allItems = getModuleNavItems(activeModule)
  const isGlobalAdmin = profile?.role === 'admin'
  const currentRole = (profile?.module_permissions || {})[activeModule.id]

  const visibleItems = isGlobalAdmin
    ? allItems
    : allItems.filter((item) => !item.roles || item.roles.includes(currentRole))

  const pageIds = visibleItems.map((item) => item.id)
  const dashboardItem = allItems.find((item) => item.id === 'dashboard')
  const canAccessDashboard = isGlobalAdmin || !dashboardItem?.roles || dashboardItem.roles.includes(currentRole)
  if (canAccessDashboard && !pageIds.includes('dashboard') && activeModule.pages?.dashboard) {
    pageIds.unshift('dashboard')
  }
  return [...new Set(pageIds)].filter((pageId) => activeModule.pages?.[pageId])
}

function AppLayout() {
  const { activeModule, activeModuleId, setActiveModuleId } = useModuleCtx()
  const { isFluidMode } = usePerformanceCtx()
  const {
    profile,
    signOut,
    storeSettings,
    activeTenantId,
    tenantLoading,
    tenantEnabledModules = [],
  } = useAuthCtx()
  const [open, setOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('@yuisync-color-mode') === 'dark')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const handleFocusMode = (event) => setFocusMode(Boolean(event.detail))
    window.addEventListener('yuisync:focus-mode', handleFocusMode)
    return () => window.removeEventListener('yuisync:focus-mode', handleFocusMode)
  }, [])

  useEffect(() => {
    setFocusMode(false)
  }, [location.pathname])

  useEffect(() => {
    localStorage.setItem('@yuisync-color-mode', darkMode ? 'dark' : 'light')
    document.body.classList.toggle('yuisync-dark', darkMode)
    return () => document.body.classList.remove('yuisync-dark')
  }, [darkMode])

  if (!activeModule) return <LauncherPage />

  if (tenantLoading || !activeTenantId) return <LoadingScreen />

  const isAdmin = profile?.role === 'admin'
  let allowed = profile?.allowed_modules || []
  if (allowed.length === 0) allowed = ['petshop']
  const tenantModules = tenantEnabledModules.length > 0 ? tenantEnabledModules : ['petshop']
  const isTenantModuleEnabled = activeModuleId === 'system' || tenantModules.includes(activeModuleId)

  if (!isTenantModuleEnabled) {
    return <Navigate to="/" replace />
  }

  if (!isAdmin && !allowed.includes(activeModuleId)) {
    return <Navigate to="/" replace />
  }

  const currentPath = location.pathname.split('/')[2] || 'dashboard'
  const accessiblePages = getAccessiblePages(activeModule, profile)
  if (accessiblePages.length === 0) {
    return <Navigate to="/" replace />
  }
  const fallbackPage = accessiblePages[0] || 'dashboard'
  const hasPageAccess = accessiblePages.includes(currentPath)

  if (!hasPageAccess) {
    return <Navigate to={`/${activeModuleId}/${fallbackPage}`} replace />
  }

  const PageComponent = activeModule.pages[currentPath] || activeModule.pages[fallbackPage]
  const setPage = (pageName) => navigate(`/${activeModuleId}/${pageName}`)

  return (
    <div className={`flex h-screen bg-bg overflow-hidden font-body theme-${activeModuleId} ${darkMode ? 'theme-dark' : ''} relative`}>
      {!focusMode && (
        <div className="absolute right-4 top-3 z-30 hidden lg:block">
          <PerformanceModeButton />
        </div>
      )}
      {activeModuleId !== 'petshop' && <StarField count={isFluidMode ? 32 : 80} className="text-emerald-500" />}
      {!focusMode && (
        <Sidebar
          profile={profile}
          onLogout={signOut}
          open={open} setOpen={setOpen}
          storeSettings={storeSettings}
          activeModule={activeModule}
          setActiveModuleId={setActiveModuleId}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((current) => !current)}
        />
      )}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 z-10">
        {!focusMode && <header className="lg:hidden flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border2)] bg-surface flex-shrink-0">
          <button type="button" aria-label="Abrir menu" onClick={() => setOpen(true)} className="text-muted hover:text-text">
            <Menu size={19} />
          </button>
          <span className="font-display font-bold text-sm text-text">
            {storeSettings?.store_name || activeModule.name}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <PerformanceModeButton compact />
            <button type="button" aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'} onClick={() => setDarkMode((current) => !current)} className="btn btn-ghost btn-sm btn-icon">
              {darkMode ? '☀' : '◐'}
            </button>
          </div>
        </header>}

        <main className="flex-1 overflow-y-auto">
          <RouteErrorBoundary key={location.pathname}>
            <Suspense fallback={<LoadingState label="Abrindo area..." />}>
              <ProductPageSurface moduleId={activeModuleId} pageId={currentPath}>
                <PageComponent setPage={setPage} />
              </ProductPageSurface>
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
      {activeModuleId === 'petshop' && (
        <>
          <PetshopOperationsEnhancer />
          <AgendaCardLayoutEnhancer />
          <PackageRecurringScheduleEnhancer />
          <DashboardAgendaLabelsEnhancer />
        </>
      )}
      {activeModuleId === 'system' && <SystemSupportPriorityAlert />}
      {activeModuleId !== 'system' && !focusMode && <SupportWidget />}
    </div>
  )
}

function PublicRoutes({ authenticated = false }) {
  return (
    <>
      <Route path="/privacidade" element={<PublicLegalPage documentKey="privacidade" />} />
      <Route path="/recuperar-senha" element={<AccountPasswordPage recovery />} />
      <Route path="/termos" element={<PublicLegalPage documentKey="termos" />} />
      <Route path="/exclusao-de-dados" element={<PublicLegalPage documentKey="exclusao" />} />
      <Route path="/site" element={<PublicHomePage isAuthenticated={authenticated || undefined} />} />
      <Route path="/vendas" element={<PublicSalesPage isAuthenticated={authenticated || undefined} />} />
      <Route path="/vendas/contratar" element={<PublicCheckoutPage isAuthenticated={authenticated || undefined} />} />
      <Route path="/agendar/:slug" element={<PublicBookingPage />} />
      <Route path="/portal/:token" element={<PublicClientPortalPage />} />
    </>
  )
}

export function AppRouter() {
  const { session, loading } = useAuthCtx()

  if (loading) return <LoadingScreen />

  if (!session) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/loading" element={<LoadingScreen />} />
          <Route path="/" element={<PublicHomePage />} />
          {PublicRoutes({ authenticated: false })}
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/:moduleId/*" element={<Navigate to="/entrar" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/loading" element={<LoadingScreen />} />
        <Route path="/" element={<LauncherPage />} />
        {PublicRoutes({ authenticated: true })}
        <Route path="/entrar" element={<Navigate to="/" replace />} />
        <Route path="/minha-conta" element={<AccountPasswordPage />} />
        <Route path="/:moduleId/*" element={<AppLayout />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
