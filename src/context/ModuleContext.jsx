import { createContext, useCallback, useContext, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const ModuleContext = createContext()

export function ModuleProvider({ children, modules }) {
  const location = useLocation()
  const activeModuleId = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    return parts[0] || null
  }, [location.pathname])

  // Compatibilidade para consumidores existentes. A URL é a única fonte de
  // verdade; os componentes que trocam de módulo também navegam para a rota.
  const setActiveModuleId = useCallback(() => {}, [])

  const activeModule = activeModuleId ? modules[activeModuleId] : null

  const value = useMemo(() => ({
    activeModuleId,
    setActiveModuleId,
    activeModule
  }), [activeModuleId, activeModule])

  return (
    <ModuleContext.Provider value={value}>
      {children}
    </ModuleContext.Provider>
  )
}

export function useModuleCtx() {
  return useContext(ModuleContext)
}
