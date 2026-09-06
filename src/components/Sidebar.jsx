import React, { useEffect, useRef, useState } from 'react'
import { LogOut, Star, Building2, RefreshCw, Moon, Sun, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { ModuleSwitcher } from './ModuleSwitcher'
import { Card } from './ui'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthCtx } from '../context/AuthContext'
import YuiSyncMark from '../public/components/YuiSyncMark'
import './Sidebar.css'

function initialSidebarCollapsed() {
  try { return localStorage.getItem('@yuisync-sidebar-collapsed') === 'true' } catch { return false }
}

export function Sidebar({ profile, onLogout, open, setOpen, storeSettings, activeModule, setActiveModuleId, darkMode, onToggleDarkMode }) {
  const isAdminGlobal = profile?.role === 'admin'
  const userModuleRole = (profile?.module_permissions || {})[activeModule.id]
  const location = useLocation()
  const { tenants = [], activeTenantId, tenantLoading, switchTenant, visualPreview } = useAuthCtx()
  const [switchingTenant, setSwitchingTenant] = useState(false)
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed)
  const [expandedContentVisible, setExpandedContentVisible] = useState(() => !initialSidebarCollapsed())
  const revealTimerRef = useRef(0)
  const expandedContentClass = expandedContentVisible ? 'yuisync-sidebar-reveal' : 'lg:hidden'
  const ActiveModuleIcon = activeModule.icon
  const navGroups = activeModule.navSections || [
    { title: 'Menu Principal', items: activeModule.nav || [] },
    ...(activeModule.adminNav ? [{ title: 'Administracao', items: activeModule.adminNav }] : []),
  ]

  const hasAccessToItem = (item) => {
    if (isAdminGlobal) return true
    if (!item.roles) return true
    return item.roles.includes(userModuleRole)
  }

  const renderNavGroup = (title, items) => {
    const visibleItems = items.filter(hasAccessToItem)
    if (visibleItems.length === 0) return null

    return (
      <div className={`mb-6 last:mb-0 ${collapsed ? 'lg:mb-3' : ''}`}>
        <p className={`mb-2 px-2.5 text-[11px] font-semibold text-[var(--muted2)] ${expandedContentClass}`}>{title}</p>
        <div className="space-y-0.5">
          {visibleItems.map(({ id, label, icon: ItemIcon }) => {
            const targetPath = `/${activeModule.id}/${id}`
            const isActive = location.pathname === targetPath

            return (
              <NavLink
                key={id}
                to={targetPath}
                onClick={() => setOpen(false)}
                title={collapsed ? label : undefined}
                className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors duration-150
                  ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                  ${isActive
                    ? `${activeModule.theme.bgLight} ${activeModule.theme.text} ${activeModule.theme.border}`
                    : 'border-transparent text-muted hover:bg-[var(--ui-hover)] hover:text-text'
                  }
                `}
              >
                <ItemIcon size={16} strokeWidth={1.8} />
                <span className={expandedContentClass}>{label}</span>
              </NavLink>
            )
          })}
        </div>
      </div>
    )
  }

  const handleGlobalTenantChange = async (tenantId) => {
    if (!tenantId || tenantId === activeTenantId) return
    try {
      setSwitchingTenant(true)
      await switchTenant(tenantId)
    } catch (error) {
      console.error('Falha ao trocar instancia ativa:', error)
    } finally {
      setSwitchingTenant(false)
    }
  }

  useEffect(() => () => {
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current)
      if (next) {
        setExpandedContentVisible(false)
      } else {
        revealTimerRef.current = window.setTimeout(() => {
          setExpandedContentVisible(true)
          revealTimerRef.current = 0
        }, 230)
      }
      try { localStorage.setItem('@yuisync-sidebar-collapsed', String(next)) } catch { /* layout preference only */ }
      return next
    })
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`
        fixed inset-y-0 left-0 z-50 flex h-full w-60 flex-col border-r border-[var(--border)] bg-surface
        overflow-x-hidden transition-[width,transform] duration-300 ease-out lg:relative
        ${collapsed ? 'lg:w-[76px]' : 'lg:w-60'}
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="border-b border-[var(--border2)] px-3 py-4">
          <div className={`mb-3 flex items-center gap-2 px-2 text-text ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <YuiSyncMark inverted={darkMode} decorative className="h-7 w-7" />
            <span className={`font-display text-sm font-extrabold tracking-[-0.035em] ${expandedContentClass}`}>YuiSync</span>
            {visualPreview && (
              <span className={`ml-auto rounded-full border border-[var(--border2)] bg-[var(--ui-hover)] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-muted ${expandedContentClass}`}>
                Local
              </span>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              className={`hidden h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--ui-hover)] hover:text-text lg:flex ${collapsed ? '' : 'ml-auto'}`}
              aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
              title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
          <div className={expandedContentClass}>
            <ModuleSwitcher
              activeModule={activeModule}
              setActiveModuleId={setActiveModuleId}
              profile={profile}
              storeSettings={storeSettings}
            />
          </div>
          {!expandedContentVisible && (
            <NavLink
              to="/"
              onClick={() => setActiveModuleId(null)}
              className={`hidden h-10 w-full items-center justify-center rounded-xl ${activeModule.theme.bgLight} ${activeModule.theme.text} lg:flex`}
              title={activeModule.name}
              aria-label={`Abrir hub de módulos. Módulo atual: ${activeModule.name}`}
            >
              <ActiveModuleIcon size={18} />
            </NavLink>
          )}
        </div>

        <nav className="custom-scrollbar flex-1 overflow-y-auto px-2.5 py-4">
          {navGroups.map((group, index) => (
            <React.Fragment key={`${group.title || 'group'}-${index}`}>
              {renderNavGroup(group.title, group.items || [])}
            </React.Fragment>
          ))}
          {!activeModule.navSections && activeModule.adminNav && renderNavGroup('Administracao', activeModule.adminNav)}
        </nav>

        <div className="space-y-2.5 border-t border-[var(--border2)] px-2.5 py-3">
          {isAdminGlobal && (
            <div className={`min-w-0 ${expandedContentClass}`}>
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted">
                <Building2 size={11} />
                Instância ativa
              </p>
              <div className="relative">
                <select
                  className="inp !py-2 !pr-8 !text-xs !font-medium"
                  value={activeTenantId || ''}
                  disabled={tenantLoading || switchingTenant || tenants.length === 0}
                  onChange={(event) => handleGlobalTenantChange(event.target.value)}
                >
                  {tenants.length === 0 && <option value="">Sem instâncias</option>}
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
                {(tenantLoading || switchingTenant) && (
                  <RefreshCw size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-muted" />
                )}
              </div>
            </div>
          )}

          <Card tone="subtle" className={`flex items-center gap-2.5 p-2.5 ${expandedContentClass}`}>
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${activeModule.theme.bgLight} text-xs font-semibold ${activeModule.theme.text}`}
            >
              {(profile?.full_name || profile?.email || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <NavLink to="/minha-conta" title="Minha conta e senha" className="block truncate text-xs font-semibold text-text hover:underline">
                {profile?.full_name || profile?.email || 'Usuário'}
              </NavLink>
              <p className="truncate text-[10px] text-muted">
                {isAdminGlobal ? (
                  <span className="flex items-center gap-1">
                    <Star size={10} className="text-amber-500" /> Admin global
                  </span>
                ) : (
                  activeModule.roles?.find((r) => r.id === userModuleRole)?.label || 'Acesso restrito'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--ui-hover)] hover:text-text"
              aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'}
              title={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'}
            >
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={onLogout} className="text-muted transition-colors hover:text-red-500" title="Sair" aria-label="Sair">
              <LogOut size={14} />
            </button>
          </Card>
          {!expandedContentVisible && (
            <NavLink to="/minha-conta" title="Minha conta e senha" aria-label="Minha conta e senha" className="hidden rounded-lg border border-[var(--border2)] p-2 text-center text-xs text-text lg:block">Conta</NavLink>
          )}
          {!expandedContentVisible && (
            <div className="hidden h-10 w-full grid-cols-2 overflow-hidden rounded-xl border border-[var(--border2)] text-muted lg:grid">
              <button
                type="button"
                onClick={onToggleDarkMode}
                className="flex items-center justify-center transition-colors hover:bg-[var(--ui-hover)] hover:text-text"
                aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'}
                title={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'}
              >
                {darkMode ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <button
                onClick={onLogout}
                className="flex items-center justify-center border-l border-[var(--border2)] transition-colors hover:bg-red-500/5 hover:text-red-500"
                title="Sair"
                aria-label="Sair"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
