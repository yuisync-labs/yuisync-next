import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Users, Search, Plus, Trash2, Edit2, ShieldAlert, Check, X, Shield,
  User as UserIcon, Briefcase, RefreshCw,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createManagedUser, listManagedUsers, updateManagedUser, updateManagedUserStatus } from '../../lib/api'
import { useAuthCtx } from '../../context/AuthContext'
import { useModuleCtx } from '../../context/ModuleContext'
import { MODULES } from '../../config/modules'

const STAFF_TYPE_OPTIONS = [
  { value: 'funcionario', label: 'Funcionario' },
  { value: 'banho_tosa', label: 'Banho / Tosa' },
  { value: 'veterinaria', label: 'Veterinaria' },
  { value: 'motodog', label: 'MotoDog' },
  { value: 'vendedor_caixa', label: 'Vendedor / Caixa' },
  { value: 'gerente', label: 'Gerente' },
]

const TEMP_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/
function getUserPermissionModuleIds() {
  return Object.keys(MODULES).filter((moduleId) => moduleId !== 'system')
}

function defaultEmployeePermissions(moduleId = 'petshop') {
  const userPermissionModuleIds = getUserPermissionModuleIds()
  const safeModuleId = userPermissionModuleIds.includes(moduleId) ? moduleId : 'petshop'
  const roleId = MODULES[safeModuleId]?.roles?.[1]?.id || MODULES[safeModuleId]?.roles?.[0]?.id
  return roleId ? { [safeModuleId]: roleId } : {}
}

function sanitizeModulePermissions(permissions = {}, fallbackModuleId = 'petshop', withFallback = false) {
  const next = {}
  const userPermissionModuleIds = getUserPermissionModuleIds()

  for (const [moduleId, roleId] of Object.entries(permissions || {})) {
    if (!userPermissionModuleIds.includes(moduleId)) continue
    const allowedRole = MODULES[moduleId]?.roles?.some((roleEntry) => roleEntry.id === roleId)
    if (allowedRole) next[moduleId] = roleId
  }

  if (withFallback && Object.keys(next).length === 0) {
    return defaultEmployeePermissions(fallbackModuleId)
  }

  return next
}

function getStaffTypeLabel(value) {
  return STAFF_TYPE_OPTIONS.find((item) => item.value === value)?.label || 'Funcionario'
}

function UserModal({
  onClose,
  onCreated,
  editingUser,
  currentUserRole,
  activeModuleId,
  currentActiveTenantId,
  availableTenants,
  onCreateBusiness,
  onConfigureBusiness,
  canManageBusiness,
}) {
  const isAdminGlobal = currentUserRole === 'admin'
  const isEditing = Boolean(editingUser)

  const [form, setForm] = useState({
    full_name: editingUser?.full_name || '',
    email: editingUser?.email || '',
    password: '',
    role: editingUser?.role || 'employee',
    staff_type: editingUser?.staff_type || 'funcionario',
    permissions: sanitizeModulePermissions(
      editingUser?.module_permissions || {},
      activeModuleId,
      (editingUser?.role || 'employee') === 'employee',
    ),
    tenantIds: editingUser?.tenant_ids || (currentActiveTenantId ? [currentActiveTenantId] : []),
    activeTenantId: editingUser?.active_tenant_id || currentActiveTenantId || null,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [newBusinessName, setNewBusinessName] = useState('')
  const [creatingBusiness, setCreatingBusiness] = useState(false)

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    if (!isAdminGlobal && !isEditing) {
      setForm((prev) => ({
        ...prev,
        permissions: defaultEmployeePermissions(activeModuleId),
        tenantIds: currentActiveTenantId ? [currentActiveTenantId] : prev.tenantIds,
        activeTenantId: currentActiveTenantId || prev.activeTenantId,
      }))
    }
  }, [isAdminGlobal, isEditing, activeModuleId, currentActiveTenantId])

  const toggleModule = (moduleId, roleId) => {
    if (!getUserPermissionModuleIds().includes(moduleId)) return
    if (!isAdminGlobal && moduleId !== activeModuleId) return
    setForm((prev) => {
      const nextPermissions = { ...prev.permissions }
      if (nextPermissions[moduleId] === roleId) delete nextPermissions[moduleId]
      else nextPermissions[moduleId] = roleId
      return { ...prev, permissions: nextPermissions }
    })
  }

  const handleRoleChange = (role) => {
    setForm((prev) => ({
      ...prev,
      role,
      tenantIds: role === 'admin'
        ? []
        : (prev.tenantIds.length ? prev.tenantIds : (currentActiveTenantId ? [currentActiveTenantId] : [])),
      activeTenantId: role === 'admin'
        ? null
        : (prev.activeTenantId || currentActiveTenantId || null),
      permissions: role === 'employee'
        ? sanitizeModulePermissions(prev.permissions, activeModuleId, true)
        : sanitizeModulePermissions(prev.permissions, activeModuleId, false),
    }))
  }

  const toggleTenant = (tenantId) => {
    setForm((prev) => {
      const exists = prev.tenantIds.includes(tenantId)
      const tenantIds = exists
        ? prev.tenantIds.filter((id) => id !== tenantId)
        : [...prev.tenantIds, tenantId]
      return {
        ...prev,
        tenantIds,
        activeTenantId: tenantIds.includes(prev.activeTenantId) ? prev.activeTenantId : (tenantIds[0] || null),
      }
    })
  }

  async function handleCreateBusiness() {
    if (!canManageBusiness) return
    const cleanName = (newBusinessName || '').trim()
    if (!cleanName) return setErr('Informe o nome do novo negocio.')

    setCreatingBusiness(true)
    setErr('')
    try {
      const tenant = await onCreateBusiness(cleanName)
      if (tenant?.id) {
        setForm((prev) => ({
          ...prev,
          tenantIds: prev.tenantIds.includes(tenant.id) ? prev.tenantIds : [tenant.id, ...prev.tenantIds],
          activeTenantId: tenant.id,
        }))
      }
      setNewBusinessName('')
      onConfigureBusiness?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setCreatingBusiness(false)
    }
  }

  async function handleSubmit() {
    const cleanPassword = form.password.trim()

    if (!form.email) return setErr('Email e obrigatorio.')
    if (!form.full_name.trim()) return setErr('Nome e obrigatorio.')
    if (!isEditing && !cleanPassword) return setErr('Senha e obrigatoria.')
    if (cleanPassword && !TEMP_PASSWORD_RE.test(cleanPassword)) {
      return setErr('A senha temporaria precisa ter 12 caracteres ou mais, com letra maiuscula, minuscula e numero.')
    }

    if (form.role === 'employee' && !isAdminGlobal && !form.permissions[activeModuleId]) {
      return setErr('Selecione um nivel de acesso para este modulo.')
    }

    if (form.role === 'employee' && canManageBusiness && form.tenantIds.length === 0) {
      return setErr('Selecione pelo menos um negocio para este login.')
    }

    setSaving(true)
    setErr('')

    try {
      const permissions = sanitizeModulePermissions(form.permissions, activeModuleId, form.role === 'employee')
      const payload = {
        full_name: form.full_name.trim(),
        role: form.role,
        staff_type: form.role === 'employee' ? form.staff_type : null,
        permissions,
        scopeModuleId: activeModuleId,
        tenantIds: form.role === 'admin'
          ? []
          : (canManageBusiness ? form.tenantIds : (currentActiveTenantId ? [currentActiveTenantId] : [])),
        activeTenantId: form.role === 'admin'
          ? null
          : (canManageBusiness ? form.activeTenantId : currentActiveTenantId),
      }

      if (isEditing) {
        await updateManagedUser(editingUser.id, {
          ...payload,
          ...(cleanPassword ? { password: cleanPassword } : {}),
        })
      } else {
        await createManagedUser({
          ...payload,
          email: form.email.trim(),
          password: cleanPassword,
        })
      }

      onCreated()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-2xl">
        <div className="modal-header">
          <h2 className="font-display font-bold text-xl text-text">
            {isEditing ? 'Editar Colaborador' : 'Novo Acesso'}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text"><X size={20} /></button>
        </div>

        <div className="modal-body space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="inp-label">Nome completo</label>
              <input
                className="inp"
                placeholder="Joao Silva"
                value={form.full_name}
                onChange={(event) => setField('full_name', event.target.value)}
              />
            </div>

            {isAdminGlobal && (
              <div className="md:col-span-2">
                <label className="inp-label">Tipo de conta</label>
                <select className="inp" value={form.role} onChange={(event) => handleRoleChange(event.target.value)}>
                  <option value="employee">Restrito por modulo</option>
                  <option value="admin">Administrador global</option>
                </select>
              </div>
            )}

            <div>
              <label className="inp-label">Email de acesso *</label>
              <input
                className="inp"
                type="email"
                placeholder="nome@empresa.com"
                value={form.email}
                onChange={(event) => setField('email', event.target.value)}
                disabled={isEditing}
              />
            </div>

            <div>
              <label className="inp-label">{isEditing ? 'Nova senha temporaria' : 'Senha temporaria *'}</label>
              <input
                className="inp"
                type="password"
                placeholder={isEditing ? 'Deixe em branco para manter' : '********'}
                value={form.password}
                onChange={(event) => setField('password', event.target.value)}
              />
              {isEditing && (
                <p className="text-xs text-muted mt-1">Preencha apenas se quiser redefinir o acesso deste usuario.</p>
              )}
            </div>
          </div>

          {form.role === 'employee' && (
            <div className="space-y-4">
              <div>
                <label className="inp-label">Area operacional</label>
                <select className="inp" value={form.staff_type} onChange={(event) => setField('staff_type', event.target.value)}>
                  {STAFF_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <label className="inp-label flex items-center gap-2">
                <Shield size={14} />
                {isAdminGlobal ? 'Configurar permissoes' : 'Nivel de acesso no modulo'}
              </label>

              <div className="grid grid-cols-1 gap-4">
                {Object.values(MODULES).map((moduleItem) => {
                  if (moduleItem.id === 'system') return null
                  if (!isAdminGlobal && moduleItem.id !== activeModuleId) return null

                  return (
                    <div key={moduleItem.id} className="petshop-click-card rounded-2xl p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-9 h-9 rounded-xl ${moduleItem.theme.primaryBg} flex items-center justify-center text-gray-900 shadow-sm`}>
                          <moduleItem.icon size={20} />
                        </div>
                        <span className="font-bold text-text text-lg">{moduleItem.name}</span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5">
                        {moduleItem.roles.map((roleEntry) => {
                          const selected = form.permissions[moduleItem.id] === roleEntry.id
                          return (
                            <button
                              key={roleEntry.id}
                              onClick={() => toggleModule(moduleItem.id, roleEntry.id)}
                              className={`petshop-click-card flex items-start gap-3 p-4 rounded-xl transition-all text-left ${selected ? 'is-selected' : ''}`}
                            >
                              <div className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-[var(--border)] bg-white'}`}>
                                {selected && <Check size={12} className="text-gray-900 font-bold" />}
                              </div>
                              <div className="flex-1">
                                <p className={`text-sm font-bold ${selected ? 'text-text' : 'text-slate-700'} leading-none mb-1.5`}>{roleEntry.label}</p>
                                <p className="text-[11px] text-muted leading-tight">{roleEntry.description}</p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {form.role === 'admin' ? (
            <div className="petshop-soft-panel rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Shield size={18} className="mt-0.5 shrink-0 text-violet-500" />
                <div>
                  <p className="text-sm font-semibold text-text">Acesso à Gestão Central</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Administradores globais pertencem à plataforma YuiSync e não precisam ser vinculados a um negócio.
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <div className="space-y-4">
            <label className="inp-label flex items-center gap-2">
              <Briefcase size={14} />
              Negocios vinculados
            </label>

            {canManageBusiness ? (
              <>
                <div className="grid grid-cols-1 gap-2.5">
                  {(availableTenants || []).map((tenant) => {
                    const selected = form.tenantIds.includes(tenant.id)
                    return (
                      <button
                        key={tenant.id}
                        onClick={() => toggleTenant(tenant.id)}
                        className={`petshop-click-card flex items-center justify-between gap-3 p-3 rounded-xl transition-all text-left ${selected ? 'is-selected' : ''}`}
                      >
                        <div>
                          <p className="text-sm font-semibold text-text">{tenant.name}</p>
                          <p className="text-[11px] text-muted">{tenant.slug || tenant.id}</p>
                        </div>
                        {selected && <Check size={14} className="text-emerald-400" />}
                      </button>
                    )
                  })}
                </div>

                <div>
                  <label className="inp-label">Negocio principal deste login</label>
                  <select
                    className="inp"
                    value={form.activeTenantId || ''}
                    onChange={(event) => setField('activeTenantId', event.target.value || null)}
                  >
                    <option value="">Selecione</option>
                    {form.tenantIds.map((tenantId) => {
                      const tenant = (availableTenants || []).find((entry) => entry.id === tenantId)
                      return <option key={tenantId} value={tenantId}>{tenant?.name || tenantId}</option>
                    })}
                  </select>
                </div>

                <div className="petshop-soft-panel rounded-xl p-3 space-y-2">
                  <p className="text-xs text-muted font-semibold">Novo negocio</p>
                  <div className="flex items-center gap-2">
                    <input
                      className="inp flex-1"
                      placeholder="Ex: PetShop Sao Pedro"
                      value={newBusinessName}
                      onChange={(event) => setNewBusinessName(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleCreateBusiness}
                      disabled={creatingBusiness}
                      className="btn btn-secondary gap-2"
                    >
                      {creatingBusiness ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                      Novo Negocio
                    </button>
                  </div>
                  <p className="text-[11px] text-muted">
                    Ao criar um novo negocio, abrimos o card de configuracao da empresa automaticamente.
                  </p>
                </div>
              </>
            ) : (
              <div className="petshop-soft-panel rounded-xl p-3">
                <p className="text-sm font-semibold text-text">Negocio atual</p>
                <p className="text-[11px] text-muted">{currentActiveTenantId || 'Negocio padrao'}</p>
              </div>
            )}
          </div>
          )}

          {err && (
            <p className="text-xs text-red-400 bg-red-500/10 p-4 rounded-xl border border-red-500/20 flex items-center gap-2">
              <ShieldAlert size={14} /> {err}
            </p>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1 justify-center border-white/5">Cancelar</button>
            <button onClick={handleSubmit} disabled={saving} className="btn btn-primary flex-1 justify-center">
              {saving ? 'Salvando...' : isEditing ? 'Atualizar' : 'Criar acesso'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function UsersPage() {
  const auth = useAuthCtx()
  const { activeModule, activeModuleId } = useModuleCtx()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState({ open: false, user: null })

  const isGlobalAdmin = auth?.profile?.role === 'admin'
  const isModuleAdmin = (auth?.profile?.module_permissions || {})[activeModuleId]?.startsWith('admin_')
  const isHubView = activeModuleId === 'system'

  useEffect(() => {
    load()
  }, [activeModuleId, isGlobalAdmin, auth?.activeTenantId])

  function hasTenantAccess(profile) {
    if (!auth?.activeTenantId) return true
    if (Array.isArray(profile?.tenant_ids) && profile.tenant_ids.includes(auth.activeTenantId)) return true
    if (Array.isArray(profile?.tenants) && profile.tenants.some((tenant) => tenant?.id === auth.activeTenantId)) return true
    return false
  }

  async function load() {
    setLoading(true)
    try {
      const scopedModuleId = isHubView ? null : activeModuleId
      const list = await listManagedUsers(scopedModuleId, isHubView ? {} : { tenantId: auth?.activeTenantId })
      const scopedList = (list || []).filter((profile) => {
        if (isHubView) return true
        if (profile.role === 'admin') return false
        const hasModulePermission = Boolean(profile?.module_permissions?.[activeModuleId])
        return hasModulePermission && hasTenantAccess(profile)
      })
      setProfiles(scopedList)
    } catch (e) {
      console.error(e)
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }

  async function toggleStatus(id, currentActive) {
    if (!isGlobalAdmin || !isHubView) return alert('Bloqueio/desbloqueio global disponivel apenas no Hub Admin.')
    if (auth?.profile?.id === id) return alert('Voce nao pode desativar seu proprio acesso.')

    try {
      await updateManagedUserStatus(id, !currentActive)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const handleEdit = (user) => {
    if (user.role === 'admin' && (!isGlobalAdmin || !isHubView)) return
    setModal({ open: true, user })
  }

  const filtered = profiles.filter((profile) =>
    !search ||
    (profile.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (profile.email || '').toLowerCase().includes(search.toLowerCase()),
  )

  const configureBusinessNow = () => {
    if (isGlobalAdmin) navigate('/system/modulos')
    else navigate(`/${activeModuleId}/config`)
  }

  return (
    <div className="page animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Shield size={22} className={activeModule.theme.textPrimary} />
            {isHubView ? 'Gestao de Acessos Global' : `Gestao da Equipe ${activeModule.shortName}`}
          </h1>
          <p className="page-sub">
            {isHubView
              ? 'Controle total da plataforma, modulos e negocios.'
              : 'Gerencie os funcionarios e niveis de acesso do seu setor.'}
          </p>
        </div>
        {(isGlobalAdmin || isModuleAdmin) && (
          <button onClick={() => setModal({ open: true, user: null })} className="btn btn-primary">
            <Plus size={16} /> {isHubView ? 'Novo Acesso Global' : 'Adicionar Colaborador'}
          </button>
        )}
      </div>

      <div className="tbl-wrapper flex flex-col min-h-[500px] mt-6">
        <div className="px-5 py-4 border-b border-[var(--border2)] flex items-center gap-4 flex-wrap bg-surface/50">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="inp pl-9"
              placeholder="Buscar por colaborador..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted text-sm py-12">Carregando...</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Area</th>
                  <th>Nivel no modulo</th>
                  <th>Negocios</th>
                  <th>Status</th>
                  <th className="text-right">Gerenciar</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((profile) => {
                  const isLocked = profile.role === 'admin' && (!isGlobalAdmin || !isHubView)
                  const tenantBadges = profile.tenants || []

                  return (
                    <tr key={profile.id} className={`hover:bg-white/[0.02] ${isLocked ? 'opacity-70' : ''}`}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl bg-surface border border-[var(--border2)] flex items-center justify-center ${profile.active ? 'text-primary' : 'text-muted opacity-50'}`}>
                            <UserIcon size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-text leading-none mb-1">{profile.full_name || 'Sem nome'}</p>
                            <p className="text-xs text-muted leading-tight">{profile.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-gray">
                          {profile.role === 'admin' ? 'Plataforma' : getStaffTypeLabel(profile.staff_type)}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {profile.role === 'admin' ? (
                            <span className="badge badge-amber text-[10px] font-black uppercase tracking-wider px-2 py-0.5 border-amber-500/20">
                              Admin Global
                            </span>
                          ) : (
                            Object.entries(sanitizeModulePermissions(profile.module_permissions || {})).map(([moduleId, roleId]) => {
                              const moduleItem = MODULES[moduleId]
                              const roleEntry = moduleItem?.roles?.find((entry) => entry.id === roleId)
                              return (
                                <span key={moduleId} className={`badge text-[10px] px-2 py-0.5 border ${moduleItem?.theme.border} ${moduleItem?.theme.bgLight} ${moduleItem?.theme.textPrimary} font-bold`}>
                                  {moduleItem?.shortName}: {roleEntry?.label}
                                </span>
                              )
                            }).concat(
                              Object.keys(sanitizeModulePermissions(profile.module_permissions || {})).length === 0
                                ? [<span key="empty" className="text-xs text-muted">Sem modulo</span>]
                                : [],
                            )
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {tenantBadges.length > 0 ? (
                            tenantBadges.map((tenant) => (
                              <span key={tenant.id} className="badge badge-blue text-[10px]">
                                {tenant.name || tenant.slug || tenant.id}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted">Sem negocio vinculado</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${profile.active ? 'badge-green' : 'badge-red'}`}>
                          {profile.active ? 'Com Acesso' : 'Bloqueado'}
                        </span>
                      </td>
                      <td className="text-right">
                        {(isGlobalAdmin || (isModuleAdmin && !isLocked)) && (
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => handleEdit(profile)}
                              className="btn btn-ghost btn-icon btn-sm text-muted hover:text-text"
                            >
                              {isLocked ? <ShieldAlert size={16} title="Protegido" /> : <Edit2 size={16} />}
                            </button>
                            {isHubView && isGlobalAdmin && !isLocked && (
                              <button
                                onClick={() => toggleStatus(profile.id, profile.active)}
                                className={`btn btn-ghost btn-icon btn-sm ${profile.active ? 'text-red-400 hover:bg-red-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'}`}
                              >
                                {profile.active ? <Trash2 size={16} /> : <Check size={16} />}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal.open && (
        <UserModal
          onClose={() => setModal({ open: false, user: null })}
          onCreated={load}
          editingUser={modal.user}
          currentUserRole={auth?.profile?.role}
          activeModuleId={activeModuleId}
          currentActiveTenantId={auth?.activeTenantId}
          availableTenants={auth?.managedTenants?.length ? auth.managedTenants : (auth?.tenants || [])}
          onCreateBusiness={async (businessName) => auth.createTenant(businessName)}
          onConfigureBusiness={configureBusinessNow}
          canManageBusiness={isHubView && (isGlobalAdmin || isModuleAdmin)}
        />
      )}
    </div>
  )
}
