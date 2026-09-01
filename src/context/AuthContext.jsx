import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { createAppTenant, getAppSettings } from '../lib/api'
import { useAuth } from '../shared/hooks/useAuth'
import { normalizeOperationalStaff } from '../../shared/petshopOperations'
import { modulePermissionForTenant } from './authPermissions'

export const AuthContext = createContext(null)

const ACTIVE_TENANT_KEY = '@yui_active_tenant'
const SUPPORTED_BUSINESS_MODULES = ['petshop']
const OPERATIONAL_STAFF_TEMPLATE_KEY = '__petshop_operational_staff'

function readStoredActiveTenant() {
  try {
    return localStorage.getItem(ACTIVE_TENANT_KEY)
  } catch {
    return null
  }
}

function writeStoredActiveTenant(tenantId) {
  try {
    if (tenantId) localStorage.setItem(ACTIVE_TENANT_KEY, tenantId)
    else localStorage.removeItem(ACTIVE_TENANT_KEY)
  } catch {
    // Browser storage is only a UI preference. Authorization is server-side.
  }
}

function pickActiveTenantId(tenants) {
  if (!Array.isArray(tenants) || tenants.length === 0) return null
  const validIds = new Set(tenants.map((tenant) => tenant.id))
  const stored = readStoredActiveTenant()
  return stored && validIds.has(stored) ? stored : tenants[0].id
}

function modulesForTenant(tenant) {
  const modules = Array.isArray(tenant?.enabled_modules) ? tenant.enabled_modules : []
  const filtered = modules.filter((moduleId) => SUPPORTED_BUSINESS_MODULES.includes(moduleId))
  return filtered.length ? [...new Set(filtered)] : ['petshop']
}

export function AuthProvider({ children }) {
  const auth = useAuth()
  const location = useLocation()
  const [storeSettings, setStoreSettings] = useState({
    store_name: '',
    store_address: '',
    store_neighborhood: '',
    store_city: '',
    store_phone: '',
    printer_width: '80',
    module_id: null,
  })
  const [tenants, setTenants] = useState([])
  const [activeTenantId, setActiveTenantId] = useState(null)
  const [tenantLoading, setTenantLoading] = useState(false)
  const [tenantError, setTenantError] = useState('')
  const [tenantEnabledModules, setTenantEnabledModules] = useState(['petshop'])

  const updateStoreSettings = useCallback((patch) => {
    setStoreSettings((current) => {
      const next = typeof patch === 'function' ? patch(current) : patch
      return { ...current, ...(next || {}) }
    })
  }, [])

  const loadTenantScope = useCallback(async () => {
    if (!auth.session?.user?.id) {
      setTenants([])
      setActiveTenantId(null)
      setTenantEnabledModules(['petshop'])
      setTenantError('')
      return
    }

    setTenantLoading(true)
    setTenantError('')
    try {
      const latest = await auth.refreshAuth()
      const nextTenants = Array.isArray(latest?.tenants) ? latest.tenants : []
      setTenants(nextTenants)
      setActiveTenantId((current) => {
        const validIds = new Set(nextTenants.map((tenant) => tenant.id))
        const next = current && validIds.has(current) ? current : pickActiveTenantId(nextTenants)
        writeStoredActiveTenant(next)
        return next
      })
    } catch (error) {
      setTenants([])
      setActiveTenantId(null)
      setTenantError(error instanceof Error ? error.message : 'Nao foi possivel carregar as instancias.')
    } finally {
      setTenantLoading(false)
    }
  }, [auth.session?.user?.id, auth.refreshAuth])

  useEffect(() => {
    const bootstrapTenants = Array.isArray(auth.bootstrap?.tenants) ? auth.bootstrap.tenants : []
    setTenants(bootstrapTenants)
    setActiveTenantId((current) => {
      const validIds = new Set(bootstrapTenants.map((tenant) => tenant.id))
      const next = current && validIds.has(current) ? current : pickActiveTenantId(bootstrapTenants)
      writeStoredActiveTenant(next)
      return next
    })
  }, [auth.bootstrap])

  const switchTenant = useCallback(async (tenantId) => {
    const allowed = tenants.some((tenant) => tenant.id === tenantId)
    if (!allowed) throw new Error('Acesso a esta instancia nao foi autorizado.')
    setActiveTenantId(tenantId)
    writeStoredActiveTenant(tenantId)
  }, [tenants])

  const createTenant = useCallback(async (name) => {
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('Informe um nome para a instancia.')
    const created = await createAppTenant(cleanName)
    const latest = await auth.refreshAuth()
    const nextTenants = Array.isArray(latest?.tenants) ? latest.tenants : []
    setTenants(nextTenants)
    const selected = nextTenants.find((tenant) => tenant.id === created.id)?.id || created.id
    setActiveTenantId(selected)
    writeStoredActiveTenant(selected)
    return created
  }, [auth.refreshAuth])

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === activeTenantId) || null,
    [tenants, activeTenantId],
  )

  const loadTenantEnabledModules = useCallback(() => {
    setTenantEnabledModules(modulesForTenant(activeTenant))
  }, [activeTenant])

  useEffect(() => {
    loadTenantEnabledModules()
  }, [loadTenantEnabledModules])

  const loadSettings = useCallback(async (moduleId) => {
    if (!moduleId || !activeTenantId || !auth.session?.user?.id) return
    try {
      const response = await getAppSettings({ tenantId: activeTenantId, moduleId })
      const row = response?.settings || {}
      setStoreSettings({
        ...row,
        module_id: moduleId,
        printer_width: row.printer_width || '80',
        petshop_operational_staff: normalizeOperationalStaff(
          row.petshop_operational_staff ?? row.message_templates?.[OPERATIONAL_STAFF_TEMPLATE_KEY],
        ),
      })
    } catch (error) {
      if (error?.status === 404) {
        setStoreSettings({ store_name: activeTenant?.name || 'YUI Sync', module_id: moduleId, printer_width: '80' })
        return
      }
      console.error('Falha ao carregar configuracoes:', error)
      setStoreSettings({ store_name: '', module_id: null, printer_width: '80' })
    }
  }, [activeTenantId, activeTenant?.name, auth.session?.user?.id])

  useEffect(() => {
    if (!auth.session?.user?.id || !activeTenantId) {
      setStoreSettings({ store_name: '', module_id: null, printer_width: '80' })
      return
    }
    const parts = location.pathname.split('/').filter(Boolean)
    const routeModuleId = parts[0] || null
    if (routeModuleId && tenantEnabledModules.includes(routeModuleId)) {
      loadSettings(routeModuleId)
    } else {
      setStoreSettings({ store_name: activeTenant?.name || 'YUI Sync', module_id: null, printer_width: '80' })
    }
  }, [auth.session?.user?.id, activeTenantId, activeTenant?.name, location.pathname, tenantEnabledModules, loadSettings])

  const effectiveProfile = useMemo(() => {
    if (!auth.profile) return null
    const enabledModules = modulesForTenant(activeTenant)
    return {
      ...auth.profile,
      role: activeTenant?.role || 'member',
      active_tenant_id: activeTenantId,
      allowed_modules: enabledModules,
      module_permissions: Object.fromEntries(
        enabledModules.map((moduleId) => [moduleId, modulePermissionForTenant(activeTenant, moduleId)]),
      ),
    }
  }, [auth.profile, activeTenant, activeTenantId])

  const value = useMemo(() => ({
    ...auth,
    profile: effectiveProfile,
    storeSettings,
    updateStoreSettings,
    refreshSettings: loadSettings,
    lastModuleId: localStorage.getItem('@app_module'),
    tenants,
    activeTenantId,
    tenantLoading,
    tenantMode: 'edge',
    tenantError,
    switchTenant,
    createTenant,
    refreshTenants: loadTenantScope,
    tenantEnabledModules,
    refreshTenantModules: loadTenantEnabledModules,
  }), [auth, effectiveProfile, storeSettings, updateStoreSettings, loadSettings, tenants, activeTenantId, tenantLoading, tenantError, switchTenant, createTenant, loadTenantScope, tenantEnabledModules, loadTenantEnabledModules])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuthCtx = () => {
  const context = useContext(AuthContext)
  if (context === undefined || context === null) throw new Error('useAuthCtx must be used within an AuthProvider')
  return context
}
