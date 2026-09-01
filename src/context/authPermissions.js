const PETSHOP_ROLE_ALIASES = Object.freeze({
  admin_pet: 'admin_pet',
  admin_petshop: 'admin_pet',
  funcionario_pet: 'funcionario_pet',
  funcionario_petshop: 'funcionario_pet',
})

export function modulePermissionForTenant(tenant, moduleId) {
  const explicit = tenant?.module_permissions?.[moduleId]
  const rawRole = typeof explicit === 'string'
    ? explicit.trim()
    : explicit && typeof explicit === 'object'
      ? String(explicit.role || explicit.id || '').trim()
      : ''

  if (moduleId === 'petshop' && rawRole) {
    return PETSHOP_ROLE_ALIASES[rawRole] || rawRole
  }
  if (rawRole) return rawRole

  if (moduleId === 'petshop') {
    return ['owner', 'admin'].includes(String(tenant?.role || '').toLowerCase())
      ? 'admin_pet'
      : 'funcionario_pet'
  }

  return explicit === true ? true : null
}
