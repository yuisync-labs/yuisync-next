type PrincipalIdentity = {
  id: string
}

type PlatformProfileRow = {
  principal_id: string
  status: string
}

export async function findPlatformProfile(
  database: D1Database,
  principal: PrincipalIdentity,
): Promise<PlatformProfileRow | null> {
  return database.prepare(`
    SELECT principal_id,status
    FROM platform_administrators
    WHERE principal_id=?1
    LIMIT 1
  `).bind(principal.id).first<PlatformProfileRow>()
}

export async function isPlatformAdmin(
  database: D1Database,
  principal: PrincipalIdentity,
): Promise<boolean> {
  const profile = await findPlatformProfile(database, principal)
  return profile?.status === 'active'
}
