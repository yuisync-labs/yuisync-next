type AuthUserInput={ id:string; email:string; name:string; email_verified:boolean; password_hash:string|null; created_at_ms:number; updated_at_ms:number }
type MembershipInput={ tenant_id:string; user_id:string; role:string; module_permissions:Record<string,unknown> }

export class AuthMigrationError extends Error{
  readonly code:'INVALID_SNAPSHOT'|'AUTH_DIVERGED'|'PRINCIPAL_MISSING'|'WRITE_FAILED'
  constructor(code:AuthMigrationError['code']){super('Auth migration failed.');this.name='AuthMigrationError';this.code=code}
}
function text(v:unknown,max=512){const s=String(v??'').trim();return s&&s.length<=max?s:null}
function int(v:unknown){const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null}
function normalize(snapshot:unknown){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new AuthMigrationError('INVALID_SNAPSHOT')
  const root=snapshot as Record<string,unknown>; if(root.schema!=='yuisync-auth-migration/v1')throw new AuthMigrationError('INVALID_SNAPSHOT')
  if(!Array.isArray(root.users)||!Array.isArray(root.memberships))throw new AuthMigrationError('INVALID_SNAPSHOT')
  const users:AuthUserInput[]=root.users.map((raw)=>{const r=raw as Record<string,unknown>;const id=text(r?.id,255);const email=text(r?.email,320)?.toLowerCase();const name=text(r?.name,255);const c=int(r?.created_at_ms);const u=int(r?.updated_at_ms);const hash=r?.password_hash==null?null:text(r.password_hash,512)
    if(!id||!email||!name||c==null||u==null||typeof r.email_verified!=='boolean'||(hash&&!/^\$2[aby]\$\d\d\$/.test(hash)))throw new AuthMigrationError('INVALID_SNAPSHOT')
    return{id,email,name,email_verified:r.email_verified,password_hash:hash,created_at_ms:c,updated_at_ms:u}})
  const seen=new Set<string>();for(const user of users){if(seen.has(user.id))throw new AuthMigrationError('INVALID_SNAPSHOT');seen.add(user.id)}
  const memberships:MembershipInput[]=root.memberships.map((raw)=>{const r=raw as Record<string,unknown>;const tenant_id=text(r?.tenant_id,160);const user_id=text(r?.user_id,255);const role=text(r?.role,32);const perms=r?.module_permissions
    if(!tenant_id||!user_id||!role||!['owner','admin','manager','staff','member'].includes(role)||!perms||typeof perms!=='object'||Array.isArray(perms))throw new AuthMigrationError('INVALID_SNAPSHOT')
    return{tenant_id,user_id,role,module_permissions:perms as Record<string,unknown>}})
  return{users,memberships}
}

export async function applyAuthMigration({authDatabase,database,snapshot}:{authDatabase?:D1Database;database?:D1Database;snapshot:unknown}){
  if(!authDatabase||!database)throw new AuthMigrationError('WRITE_FAILED')
  const {users,memberships}=normalize(snapshot)
  const principalByUser=new Map<string,string>()
  for(const user of users){
    const principal=await database.prepare("SELECT id,status FROM identity_principals WHERE provider='supabase' AND subject=?1 LIMIT 1").bind(user.id).first<{id:string;status:string}>()
      ?? await database.prepare("SELECT id,status FROM identity_principals WHERE provider='better-auth' AND subject=?1 LIMIT 1").bind(user.id).first<{id:string;status:string}>()
    if(!principal||principal.status!=='active')throw new AuthMigrationError('PRINCIPAL_MISSING')
    principalByUser.set(user.id,principal.id)

    const existing=await authDatabase.prepare('SELECT id,name,email,emailVerified FROM user WHERE id=?1').bind(user.id).first<Record<string,unknown>>()
    if(existing && (existing.name!==user.name||String(existing.email).toLowerCase()!==user.email||Number(existing.emailVerified)!==(user.email_verified?1:0)))throw new AuthMigrationError('AUTH_DIVERGED')
    const account=user.password_hash?await authDatabase.prepare("SELECT userId,accountId,password FROM account WHERE providerId='credential' AND accountId=?1 LIMIT 1").bind(user.id).first<Record<string,unknown>>():null
    if(account&&(account.userId!==user.id||account.password!==user.password_hash))throw new AuthMigrationError('AUTH_DIVERGED')
  }

  for(const user of users){
    const statements:D1PreparedStatement[]=[]
    const existing=await authDatabase.prepare('SELECT id FROM user WHERE id=?1').bind(user.id).first()
    if(!existing)statements.push(authDatabase.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,?4,NULL,?5,?6)').bind(user.id,user.name,user.email,user.email_verified?1:0,user.created_at_ms,user.updated_at_ms))
    if(user.password_hash){const account=await authDatabase.prepare("SELECT id FROM account WHERE providerId='credential' AND accountId=?1 LIMIT 1").bind(user.id).first()
      if(!account)statements.push(authDatabase.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?2,\'credential\',?3,?4,?5)').bind(`credential:${user.id}`,user.id,user.password_hash,user.created_at_ms,user.updated_at_ms))}
    if(statements.length)try{await authDatabase.batch(statements)}catch{throw new AuthMigrationError('WRITE_FAILED')}
  }

  for(const membership of memberships){
    const principalId=principalByUser.get(membership.user_id);if(!principalId)throw new AuthMigrationError('PRINCIPAL_MISSING')
    const result=await database.prepare('UPDATE tenant_memberships SET role=?1,module_permissions_json=?2,updated_at_ms=?3 WHERE tenant_id=?4 AND principal_id=?5 AND status=\'active\'')
      .bind(membership.role,JSON.stringify(membership.module_permissions),Date.now(),membership.tenant_id,principalId).run()
    if(!result.success||result.meta.changes!==1)throw new AuthMigrationError('WRITE_FAILED')
  }

  for(const user of users){
    const principalId=principalByUser.get(user.id)!
    try{
      const result=await database.prepare("UPDATE identity_principals SET provider='better-auth',display_name=?1,email=?2,updated_at_ms=?3 WHERE id=?4 AND provider IN ('supabase','better-auth') AND subject=?5")
        .bind(user.name,user.email,Date.now(),principalId,user.id).run()
      if(!result.success||result.meta.changes!==1)throw new Error('transition failed')
    }catch{throw new AuthMigrationError('WRITE_FAILED')}
  }
  return Object.freeze({status:'migrated',userCount:users.length,membershipCount:memberships.length,sessionsMigrated:0})
}
