import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PRODUCTION = process.argv.includes('--production')
const ENVIRONMENT = PRODUCTION ? 'production' : 'staging'
const CREDENTIAL_FILE = resolve(REPO_ROOT, `.migration/quatro-patas-${ENVIRONMENT}-credentials.json`)
const APP_URL = PRODUCTION ? 'https://yuisync.app' : 'https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev'
const TENANT_ID = '29d6a509-8b35-47d0-ad19-7cee6f17328c'

async function jsonResponse(response, label) {
  if (!response.ok) throw new Error(`${label}_HTTP_${response.status}`)
  return response.json()
}

const credential = JSON.parse(await readFile(CREDENTIAL_FILE, 'utf8'))
const signIn = await fetch(`${APP_URL}/api/auth/sign-in/email`, {
  method:'POST', headers:{ 'content-type':'application/json',origin:APP_URL },
  body:JSON.stringify({ email:credential.email,password:credential.password,rememberMe:false }), redirect:'manual',
})
if (!signIn.ok) throw new Error(`SIGN_IN_HTTP_${signIn.status}`)
const cookies = typeof signIn.headers.getSetCookie === 'function' ? signIn.headers.getSetCookie() : [signIn.headers.get('set-cookie')].filter(Boolean)
const cookie = cookies.map((value) => String(value).split(';', 1)[0]).filter(Boolean).join('; ')
if (!cookie) throw new Error('SESSION_COOKIE_MISSING')

const session = await jsonResponse(await fetch(`${APP_URL}/api/auth/get-session`, { headers:{ cookie,origin:APP_URL } }), 'SESSION')
if (session?.user?.id !== credential.user_id) throw new Error('SESSION_USER_MISMATCH')
const bootstrap = await jsonResponse(await fetch(`${APP_URL}/api/app/bootstrap`, { headers:{ cookie } }), 'BOOTSTRAP')
if (!(bootstrap?.tenants || []).some((tenant) => tenant.id === TENANT_ID)) throw new Error('BOOTSTRAP_TENANT_MISSING')
if (process.argv.includes('--describe-bootstrap')) {
  console.log(JSON.stringify({
    profile:{ id:bootstrap?.profile?.id, role:bootstrap?.profile?.role, active:bootstrap?.profile?.active },
    tenants:(bootstrap?.tenants || []).map((tenant) => ({
      id:tenant.id, name:tenant.name, role:tenant.role,
      enabled_modules:tenant.enabled_modules, module_permissions:tenant.module_permissions,
    })),
  }))
}
const settings = await jsonResponse(await fetch(`${APP_URL}/api/app/settings?tenant_id=${encodeURIComponent(TENANT_ID)}&module_id=petshop`, { headers:{ cookie } }), 'SETTINGS')
if (!String(settings?.settings?.store_name || settings?.store_name || '').toLowerCase().includes('quatro')) throw new Error('SETTINGS_STORE_MISMATCH')

const checks = {}
for (const table of ['clients','pets','appointments','products','petshop_services']) {
  const response = await fetch(`${APP_URL}/api/compat/query`, {
    method:'POST',
    headers:{ 'content-type':'application/json',cookie,'x-tenant-id':TENANT_ID,'x-module-id':'petshop' },
    body:JSON.stringify({ table,action:'select',filters:[],limit:1 }),
  })
  const body = await jsonResponse(response, `COMPAT_${table.toUpperCase()}`)
  if (!Array.isArray(body?.data) || body.data.length !== 1) throw new Error(`COMPAT_${table.toUpperCase()}_EMPTY`)
  checks[table] = 'readable'
}

console.log(JSON.stringify({ status:'authenticated-canary-passed',environment:ENVIRONMENT,tenant_id:TENANT_ID,checks }))
