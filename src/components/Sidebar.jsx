import React, { useState } from 'react'
import { LogOut, Star, Building2, RefreshCw, Moon, Sun } from 'lucide-react'
import { ModuleSwitcher } from './ModuleSwitcher'
import { Card } from './ui'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthCtx } from '../context/AuthContext'

export function Sidebar({ profile, onLogout, open, setOpen, storeSettings, activeModule, setActiveModuleId, darkMode, onToggleDarkMode }) {
  const isAdminGlobal = profile?.role === 'admin'
  const userModuleRole = (profile?.module_permissions || {})[activeModule.id]
  const location = useLocation()
  const { tenants = [], activeTenantId, tenantLoading, switchTenant } = useAuthCtx()
  const [switchingTenant, setSwitchingTenant] = useState(false)
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
      <div className="mb-6 last:mb-0">
        <p className="mb-2 px-2.5 text-[11px] font-semibold text-muted/60">{title}</p>
        <div className="space-y-0.5">
          {visibleItems.map(({ id, label, icon: ItemIcon }) => {
            const targetPath = `/${activeModule.id}/${id}`
            const isActive = location.pathname === targetPath

            return (
              <NavLink
                key={id}
                to={targetPath}
                onClick={() => setOpen(false)}
                className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors duration-150
                  ${isActive
                    ? `${activeModule.theme.bgLight} ${activeModule.theme.text} ${activeModule.theme.border}`
                    : 'border-transparent text-muted hover:bg-white/5 hover:text-text'
                  }
                `}
              >
                <ItemIcon size={16} strokeWidth={1.8} />
                <span>{label}</span>
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

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />
      )}
      <aside
        className={`
        fixed inset-y-0 left-0 z-50 flex h-full w-60 flex-col border-r border-[var(--border)] bg-surface
        transition-transform duration-300 lg:relative
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
      >
        <div className="border-b border-[var(--border2)] px-3 py-4">
          <ModuleSwitcher
            activeModule={activeModule}
            setActiveModuleId={setActiveModuleId}
            profile={profile}
            storeSettings={storeSettings}
          />
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
          <div className="flex items-end gap-2">
            {isAdminGlobal && (
              <div className="min-w-0 flex-1">
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
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="btn btn-ghost btn-icon w-10 h-10 shrink-0 justify-center !px-0"
              aria-label={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'}
              title={darkMode ? 'Ativar modo claro' : 'Ativar modo noturno'}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          <Card tone="subtle" className="flex items-center gap-2.5 p-2.5">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${activeModule.theme.bgLight} text-xs font-semibold ${activeModule.theme.text}`}
            >
              {(profile?.full_name || profile?.email || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-text">
                {profile?.full_name || profile?.email || 'Usuário'}
              </p>
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
            <button onClick={onLogout} className="text-muted transition-colors hover:text-red-500" title="Sair" aria-label="Sair">
              <LogOut size={14} />
            </button>
          </Card>
        </div>
      </aside>
    </>
  )
}
