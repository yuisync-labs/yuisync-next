import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { hash } from 'bcryptjs'

// Dedicated persistent CI accounts, distinct from ephemeral release fixtures.
// No production configuration override and no sweeping/deleting other fixtures.
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = resolve(root, '.artifacts/ci-staging')
const manifestPath = resolve(dir, 'accounts.json')
const base = 'https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev'
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: '7eb4b696a14fde38c74edde4ebfcd1d9' }
const mode = process.argv[2]
if (!['setup', 'secrets', 'verify', 'e2e'].includes(mode)) throw new Error('Use setup|secrets|verify|e2e')
execFileSync('git', ['check-ignore', '.artifacts/ci-staging/accounts.json'], { cwd: root, stdio: 'pipe' })
const q = value => `'${String(value).replaceAll("'", "''")}'`
let calls = 0
function d1(binding, statement) {
  if (++calls > 4) throw new Error('PROVISION_QUERY_BUDGET_EXCEEDED')
  try {
    execFileSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', binding,
      '--config', resolve(root, 'apps/edge-api/wrangler.jsonc'), '--env', 'staging', '--remote', '--command', statement],
    { cwd: root, env, stdio: 'pipe', timeout: 60000 })
  } catch { throw new Error(`STAGING_PROVISION_FAILED:${binding}`) }
}
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
  if (mode !== 'setup') throw new Error('SETUP_REQUIRED')
  const id = `ci-${randomUUID()}`
  manifest = { version: 1, base, tenants: [`${id}-a`, `${id}-b`], users: ['admin', 'manager', 'member', 'isolation'].map((key, index) => ({
    key, id: randomUUID(), principal: randomUUID(), tenantIndex: index === 3 ? 1 : 0,
    email: `${id}-${key}@staging.invalid`, password: `${randomBytes(24).toString('base64url')}Aa1!`,
    role: key === 'member' ? 'member' : key === 'manager' ? 'manager' : 'admin',
    moduleRole: key === 'member' ? 'funcionario_pet' : 'admin_pet',
  })) }
  await mkdir(dir, { recursive: true })
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' })
}
if (manifest.base !== base || manifest.tenants.length !== 2 || manifest.tenants.some(id => !/^ci-[a-f0-9-]+-[ab]$/.test(id))) throw new Error('INVALID_STAGING_MANIFEST')
const vars = { E2E_BASE_URL: base }
for (const user of manifest.users) {
  const prefix = { admin: 'E2E', manager: 'E2E_MANAGER', member: 'E2E_COMMON', isolation: 'TENANT_B' }[user.key]
  vars[`${prefix}_EMAIL`] = user.email
  vars[`${prefix}_PASSWORD`] = user.password
}
Object.assign(vars, { TENANT_A_EMAIL: vars.E2E_EMAIL, TENANT_A_PASSWORD: vars.E2E_PASSWORD, TENANT_A_ID: manifest.tenants[0], TENANT_B_ID: manifest.tenants[1] })
if (mode === 'setup') {
  const now = Date.now(), date = q(new Date(now).toISOString())
  const auth = [], main = []
  for (const tenant of manifest.tenants) main.push(
    `INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(${q(tenant)},${q(tenant)},'CI isolated company','active',${now},${now}) ON CONFLICT(id) DO NOTHING;`,
    `INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,created_at_ms,updated_at_ms) VALUES(${q(tenant)},'petshop','CI isolated company',${now},${now}) ON CONFLICT(tenant_id,module_id) DO NOTHING;`)
  for (const user of manifest.users) {
    const tenant = manifest.tenants[user.tenantIndex]
    auth.push(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(${q(user.id)},${q(`CI ${user.key}`)},${q(user.email)},1,${date},${date}) ON CONFLICT(id) DO NOTHING;`,
      `INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(${q(`credential:${user.id}`)},${q(user.id)},${q(user.id)},'credential',${q(await hash(user.password,12))},${date},${date}) ON CONFLICT(id) DO NOTHING;`)
    main.push(`INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(${q(user.principal)},'better-auth',${q(user.id)},${q(`CI ${user.key}`)},${q(user.email)},'active',${now},${now}) ON CONFLICT(id) DO NOTHING;`,
      `INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,module_permissions_json,created_at_ms,updated_at_ms) VALUES(${q(tenant)},${q(user.principal)},${q(user.role)},'active',${q(JSON.stringify({petshop:{role:user.moduleRole}}))},${now},${now}) ON CONFLICT(tenant_id,principal_id) DO NOTHING;`)
  }
  d1('AUTH_DB', auth.join('\n'))
  d1('DB', main.join('\n'))
  console.log('Provisioned 2 staging companies and 4 CI accounts; reruns reuse the manifest.')
} else if (mode === 'secrets') {
  for (const [key, value] of Object.entries(vars)) {
    try { execFileSync('gh', ['secret', 'set', key, '--repo', 'yuisync-labs/yuisync-next'], { cwd: root, input: value, stdio: ['pipe','pipe','pipe'] }) }
    catch { throw new Error(`GITHUB_SECRET_FAILED:${key}`) }
    console.log(`Configured ${key}`)
  }
} else {
  const args = mode === 'verify' ? ['scripts/test-tenant-isolation.mjs'] : ['node_modules/@playwright/test/cli.js', 'test', '--project=desktop', '--workers=1', '--max-failures=1']
  try { execFileSync(process.execPath, args, { cwd: root, env: { ...env, ...vars }, stdio: 'inherit', timeout: 900000 }) }
  catch { process.exitCode = 1 }
}
