import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { createAppTenant, getAppSettings } from '../lib/api'
import { useAuth } from '../shared/hooks/useAuth'
import { normalizeOperationalStaff } from '../../shared/petshopOperations'
import { modulePermissionForTenant } from './authPermissions'

export const AuthContext = createContext(null)

const ACTIVE_TENANT_KEY = '@yui_active_tenant'
const SUPPORTED_BUSINESS_MODULES = ['petshop']
const OPERATIONAL_STAFF_TEMPLATE_KEY = '__petshop_operational_staff'

function neutralStoreSettings(tenantName = '', moduleId = null) {
  return {
    store_name: String(tenantName || '').trim() || 'Estabelecimento',
    store_address: '',
    store_neighborhood: '',
    store_city: '',
    store_phone: '',
    receipt_logo_data_url: '',
    printer_width: '80',
    module_id: moduleId,
  }
}

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
  const [storeSettings, setStoreSettings] = useState(() => neutralStoreSettings())
  const [tenants, setTenants] = useState([])
  const [activeTenantId, setActiveTenantId] = useState(null)
  const activeTenantIdRef = useRef(null)
  const [tenantLoading, setTenantLoading] = useState(false)
  const [tenantError, setTenantError] = useState('')
  const [tenantEnabledModules, setTenantEnabledModules] = useState(['petshop'])

  const updateStoreSettings = useCallback((patch) => {
    setStoreSettings((current) => {
      const next = typeof patch === 'function' ? patch(current) : patch
      return { ...current, ...(next || {}) }
    })
  }, [])

  const selectTenant = useCallback((tenantId, tenantName = '') => {
    activeTenantIdRef.current = tenantId || null
    setActiveTenantId(tenantId || null)
    setStoreSettings(neutralStoreSettings(tenantName))
    writeStoredActiveTenant(tenantId || null)
  }, [])

  const loadTenantScope = useCallback(async () => {
    if (!auth.session?.user?.id) {
      setTenants([])
      selectTenant(null)
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
      const current = activeTenantIdRef.current
      const validIds = new Set(nextTenants.map((tenant) => tenant.id))
      const next = current && validIds.has(current) ? current : pickActiveTenantId(nextTenants)
      const tenantName = nextTenants.find((tenant) => tenant.id === next)?.name || ''
      if (next !== activeTenantIdRef.current) selectTenant(next, tenantName)
      else writeStoredActiveTenant(next)
    } catch (error) {
      setTenants([])
      selectTenant(null)
      setTenantError(error instanceof Error ? error.message : 'Nao foi possivel carregar as instancias.')
    } finally {
      setTenantLoading(false)
    }
  }, [auth.session?.user?.id, auth.refreshAuth, selectTenant])

  useEffect(() => {
    const bootstrapTenants = Array.isArray(auth.bootstrap?.tenants) ? auth.bootstrap.tenants : []
    setTenants(bootstrapTenants)
    const current = activeTenantIdRef.current
    const validIds = new Set(bootstrapTenants.map((tenant) => tenant.id))
    const next = current && validIds.has(current) ? current : pickActiveTenantId(bootstrapTenants)
    const tenantName = bootstrapTenants.find((tenant) => tenant.id === next)?.name || ''
    if (next !== activeTenantIdRef.current) selectTenant(next, tenantName)
    else writeStoredActiveTenant(next)
  }, [auth.bootstrap, selectTenant])

  const switchTenant = useCallback(async (tenantId) => {
    const tenant = tenants.find((candidate) => candidate.id === tenantId)
    if (!tenant) throw new Error('Acesso a esta instancia nao foi autorizado.')
    selectTenant(tenantId, tenant.name)
  }, [tenants, selectTenant])

  const createTenant = useCallback(async (name) => {
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('Informe um nome para a instancia.')
    const created = await createAppTenant(cleanName)
    const latest = await auth.refreshAuth()
    const nextTenants = Array.isArray(latest?.tenants) ? latest.tenants : []
    setTenants(nextTenants)
    const selectedTenant = nextTenants.find((tenant) => tenant.id === created.id) || created
    selectTenant(selectedTenant.id, selectedTenant.name)
    return created
  }, [auth.refreshAuth, selectTenant])

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
    const requestedTenantId = activeTenantId
    try {
      const response = await getAppSettings({ tenantId: requestedTenantId, moduleId })
      if (activeTenantIdRef.current !== requestedTenantId) return
      const row = response?.settings || {}
      setStoreSettings({
        ...neutralStoreSettings(activeTenant?.name, moduleId),
        ...row,
        module_id: moduleId,
        printer_width: row.printer_width === '58' ? '58' : '80',
        receipt_logo_data_url: String(row.receipt_logo_data_url || ''),
        petshop_operational_staff: normalizeOperationalStaff(
          row.petshop_operational_staff ?? row.message_templates?.[OPERATIONAL_STAFF_TEMPLATE_KEY],
        ),
      })
    } catch (error) {
      if (activeTenantIdRef.current !== requestedTenantId) return
      if (error?.status === 404) {
        setStoreSettings(neutralStoreSettings(activeTenant?.name, moduleId))
        return
      }
      console.error('Falha ao carregar configuracoes:', error)
      setStoreSettings(neutralStoreSettings(activeTenant?.name))
    }
  }, [activeTenantId, activeTenant?.name, auth.session?.user?.id])

  useEffect(() => {
    if (!auth.session?.user?.id || !activeTenantId) {
      activeTenantIdRef.current = activeTenantId || null
      setStoreSettings(neutralStoreSettings())
      return
    }
    activeTenantIdRef.current = activeTenantId
    const parts = location.pathname.split('/').filter(Boolean)
    const routeModuleId = parts[0] || null
    if (routeModuleId && tenantEnabledModules.includes(routeModuleId)) {
      loadSettings(routeModuleId)
    } else {
      setStoreSettings(neutralStoreSettings(activeTenant?.name))
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
