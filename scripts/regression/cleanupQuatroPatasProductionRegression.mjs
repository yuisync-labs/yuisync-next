import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MANIFEST_FILE = resolve(REPO_ROOT, '.migration/quatro-patas-production-regression.json')
const CREDENTIAL_FILE = resolve(REPO_ROOT, '.migration/quatro-patas-production-credentials.json')
const WRANGLER = resolve(REPO_ROOT, 'node_modules/wrangler/bin/wrangler.js')
const APP_URL = 'https://yuisync.app'
const EXPECTED_TENANT_ID = '29d6a509-8b35-47d0-ad19-7cee6f17328c'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

async function d1(command) {
  let lastError
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await run(process.execPath, [
        WRANGLER,
        'd1', 'execute', 'yuisync-next-production',
        '--remote', '--env', 'production',
        '--config', 'apps/edge-api/.wrangler-production.jsonc',
        '--command', command,
      ], { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 })
    } catch (error) {
      lastError = error
      if (attempt < 4) await delay(attempt * 1500)
    }
  }
  throw lastError
}

async function authenticate() {
  const credential = JSON.parse(await readFile(CREDENTIAL_FILE, 'utf8'))
  const response = await fetch(`${APP_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_URL },
    body: JSON.stringify({ email: credential.email, password: credential.password, rememberMe: false }),
    redirect: 'manual',
  })
  if (!response.ok) throw new Error(`SIGN_IN_HTTP_${response.status}`)
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies.map((value) => String(value).split(';', 1)[0]).filter(Boolean).join('; ')
  if (!cookie) throw new Error('SESSION_COOKIE_MISSING')
  return cookie
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'))
  if (manifest.tenant_id !== EXPECTED_TENANT_ID || manifest.module_id !== 'petshop') throw new Error('MANIFEST_SCOPE_MISMATCH')
  if (!ID.test(manifest.client_id) || !ID.test(manifest.pet_id)) throw new Error('MANIFEST_CLIENT_IDS_INVALID')
  const appointmentIds = (manifest.appointments || []).map((item) => item.id)
  if (appointmentIds.length !== 4 || appointmentIds.some((id) => !ID.test(id))) throw new Error('MANIFEST_APPOINTMENT_IDS_INVALID')
  const appointmentList = appointmentIds.map(sql).join(',')

  const preflight = await d1(`SELECT
    (SELECT COUNT(*) FROM clients WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id=${sql(manifest.client_id)}) AS clients,
    (SELECT COUNT(*) FROM pets WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id=${sql(manifest.pet_id)}) AS pets,
    (SELECT COUNT(*) FROM appointments WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id IN (${appointmentList})) AS appointments;`)
  if (!/"clients"\s*:\s*1/.test(preflight.stdout) || !/"pets"\s*:\s*1/.test(preflight.stdout) || !/"appointments"\s*:\s*4/.test(preflight.stdout)) {
    throw new Error(`D1_PREFLIGHT_UNEXPECTED:${preflight.stdout.slice(-1200)}`)
  }

  await d1(`
    DELETE FROM system_update_logs
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND source='appointment-command'
        AND json_extract(metadata,'$.appointment_id') IN (${appointmentList});
    DELETE FROM appointment_command_registry
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND appointment_id IN (${appointmentList});
    DELETE FROM subscription_benefit_allocations
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND appointment_id IN (${appointmentList});
    DELETE FROM appointment_transport
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND appointment_id IN (${appointmentList});
    DELETE FROM appointment_services
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND appointment_id IN (${appointmentList});
    DELETE FROM appointments
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id IN (${appointmentList});
    DELETE FROM pets
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id=${sql(manifest.pet_id)} AND client_id=${sql(manifest.client_id)};
    DELETE FROM clients
      WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id=${sql(manifest.client_id)};
  `)

  const verification = await d1(`SELECT
    (SELECT COUNT(*) FROM clients WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id=${sql(manifest.client_id)}) AS clients,
    (SELECT COUNT(*) FROM pets WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id=${sql(manifest.pet_id)}) AS pets,
    (SELECT COUNT(*) FROM appointments WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND id IN (${appointmentList})) AS appointments,
    (SELECT COUNT(*) FROM appointment_services WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND appointment_id IN (${appointmentList})) AS appointment_services,
    (SELECT COUNT(*) FROM appointment_command_registry WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND appointment_id IN (${appointmentList})) AS command_registry,
    (SELECT COUNT(*) FROM system_update_logs WHERE tenant_id=${sql(EXPECTED_TENANT_ID)} AND module_id='petshop' AND json_extract(metadata,'$.appointment_id') IN (${appointmentList})) AS audit_logs;`)
  for (const key of ['clients', 'pets', 'appointments', 'appointment_services', 'command_registry', 'audit_logs']) {
    if (!new RegExp(`"${key}"\\s*:\\s*0`).test(verification.stdout)) throw new Error(`D1_CLEANUP_VERIFY_FAILED:${key}`)
  }

  const cookie = await authenticate()
  const clientsResponse = await fetch(`${APP_URL}/api/petshop/clients?search=${encodeURIComponent(manifest.marker)}&limit=20`, {
    headers: { cookie, 'x-tenant-id': EXPECTED_TENANT_ID, 'x-module-id': 'petshop' },
  })
  const clientsBody = await clientsResponse.json()
  if (!clientsResponse.ok || !Array.isArray(clientsBody.clients) || clientsBody.clients.length !== 0) throw new Error('API_CLEANUP_VERIFY_FAILED')

  manifest.cleaned_at = new Date().toISOString()
  manifest.cleanup_status = 'verified-zero'
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    status: 'production-regression-cleanup-passed',
    tenant_id: EXPECTED_TENANT_ID,
    removed: { clients: 1, pets: 1, appointments: 4 },
    verified_zero: ['clients', 'pets', 'appointments', 'appointment_services', 'appointment_command_registry', 'system_update_logs'],
  }))
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'production-regression-cleanup-failed', error: String(error?.message || error) }))
  process.exitCode = 1
})
