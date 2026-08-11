import React, { useState, useRef, useEffect } from 'react'
import { ChevronRight, Check } from 'lucide-react'
import { MODULES } from '../config/modules'
import { useNavigate } from 'react-router-dom'
import { useAuthCtx } from '../context/AuthContext'
import { Card } from './ui'

export function ModuleSwitcher({ activeModule, setActiveModuleId, profile, storeSettings }) {
  const [openDrop, setOpenDrop] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const { tenantEnabledModules = [] } = useAuthCtx()

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpenDrop(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isAdmin = profile?.role === 'admin'
  const allowed = profile?.allowed_modules || []
  const tenantModules = tenantEnabledModules.length > 0 ? tenantEnabledModules : ['petshop']

  const modulesList = Object.values(MODULES).filter(m => {
    if (m.id === 'system') return isAdmin
    if (!tenantModules.includes(m.id)) return false
    if (isAdmin) return true
    if (allowed.length === 0) return m.id === 'petshop'
    return allowed.includes(m.id)
  })

  const hasMultiple = modulesList.length > 1 || isAdmin
  const Icon = activeModule.icon

  return (
    <div className="relative" ref={ref}>
      <Card
        as="button"
        type="button"
        tone="subtle"
        interactive={hasMultiple}
        disabled={!hasMultiple}
        onClick={() => setOpenDrop(!openDrop)}
        className={`flex w-full items-center gap-2.5 p-2 text-left ${hasMultiple ? '' : 'cursor-default opacity-80'}`}
      >
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] ${activeModule.theme.primaryBg} text-gray-950`}>
          <Icon size={17} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold leading-none text-text">
            {activeModule.id === 'system' ? 'Gestão Central' : (storeSettings?.store_name || activeModule.name)}
          </p>
          <p className="mt-1 truncate text-[10px] font-medium text-muted">
            {hasMultiple ? 'Trocar módulo' : 'Aplicativo ativo'}
          </p>
        </div>
        {hasMultiple && <ChevronRight size={14} className={`text-muted transition-transform ${openDrop ? 'rotate-90' : ''}`} />}
      </Card>

      {openDrop && (
        <Card tone="neutral" className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden py-1">
          {modulesList.map((m) => {
            const isSelected = m.id === activeModule.id
            const ModIcon = m.icon
            const defaultPage = (
              m.navSections?.[0]?.items?.[0]?.id
              || m.nav?.[0]?.id
              || 'dashboard'
            )
            return (
              <button
                key={m.id}
                type="button"
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5 ${isSelected ? m.theme.textPrimary : 'text-text'}`}
                onClick={() => {
                  setActiveModuleId(m.id)
                  setOpenDrop(false)
                  navigate(`/${m.id}/${defaultPage}`)
                }}
              >
                <ModIcon size={16} className={isSelected ? m.theme.textPrimary : 'text-muted'} />
                <span className="flex-1 font-medium">{m.name}</span>
                {isSelected && <Check size={14} className={m.theme.textPrimary} />}
              </button>
            )
          })}
          <div className="mt-1 border-t border-[var(--border2)] pt-1">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-white/5"
              onClick={() => {
                setActiveModuleId(null)
                setOpenDrop(false)
                navigate('/')
              }}
            >
              Voltar ao Hub Central
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}
