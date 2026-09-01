import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const APP_URL = 'https://yuisync.app'
const TENANT_ID = '29d6a509-8b35-47d0-ad19-7cee6f17328c'
const MODULE_ID = 'petshop'
const CREDENTIAL_FILE = resolve(REPO_ROOT, '.migration/quatro-patas-production-credentials.json')
const MANIFEST_FILE = resolve(REPO_ROOT, '.migration/quatro-patas-production-regression.json')

const normalize = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const compactId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 10)

async function responseJson(response, label) {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${label}_HTTP_${response.status}:${JSON.stringify(body)}`)
  }
  return body
}

async function authenticate() {
  const credential = JSON.parse(await readFile(CREDENTIAL_FILE, 'utf8'))
  const signIn = await fetch(`${APP_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_URL },
    body: JSON.stringify({ email: credential.email, password: credential.password, rememberMe: false }),
    redirect: 'manual',
  })
  if (!signIn.ok) throw new Error(`SIGN_IN_HTTP_${signIn.status}`)
  const setCookies = typeof signIn.headers.getSetCookie === 'function'
    ? signIn.headers.getSetCookie()
    : [signIn.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies.map((value) => String(value).split(';', 1)[0]).filter(Boolean).join('; ')
  if (!cookie) throw new Error('SESSION_COOKIE_MISSING')

  const bootstrap = await responseJson(await fetch(`${APP_URL}/api/app/bootstrap`, { headers: { cookie } }), 'BOOTSTRAP')
  const tenant = (bootstrap?.tenants || []).find((item) => item.id === TENANT_ID)
  if (!tenant || tenant.name !== 'PetShop QuatroPatas') throw new Error('EXPECTED_TENANT_NOT_ACTIVE')
  return cookie
}

function headers(cookie, json = false) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    cookie,
    'x-tenant-id': TENANT_ID,
    'x-module-id': MODULE_ID,
  }
}

async function compat(cookie, payload, label) {
  return responseJson(await fetch(`${APP_URL}/api/compat/query`, {
    method: 'POST',
    headers: headers(cookie, true),
    body: JSON.stringify(payload),
  }), label)
}

function serviceIdentity(service) {
  return {
    id: String(service.id || service.service_id || ''),
    code: String(service.code || service.service_type || ''),
    name: String(service.name || service.service_name || ''),
    group: String(service.group_type || service.service_group || 'outro'),
    price: Number(service.default_price ?? service.price ?? service.unit_price ?? 0),
    duration: Number(service.default_duration_min ?? service.duration_min ?? 60),
  }
}

function pickService(services, label, predicate) {
  const match = services.map(serviceIdentity).find((service) => service.id && service.code && predicate(normalize(service.name)))
  if (!match) throw new Error(`SERVICE_NOT_FOUND:${label}`)
  return match
}

async function createAppointment(cookie, manifest, service, index, machineNo = null) {
  const scheduledAt = new Date(Date.UTC(2026, 8, 28, 18 + index, 0, 0)).toISOString()
  const payload = {
    tenant_id: TENANT_ID,
    module_id: MODULE_ID,
    client_id: manifest.client_id,
    pet_id: manifest.pet_id,
    service_type: service.code,
    services: [{ code: service.code }],
    service_group: service.group || 'outro',
    scheduled_at: scheduledAt,
    duration_min: Math.max(15, service.duration || 60),
    price: Math.max(0, service.price || 1),
    status: 'concluido',
    source: 'manual',
    transport_mode: 'cliente_leva',
    notes: manifest.marker,
    idempotency_key: `${manifest.marker}:${service.code}:${index}`,
  }
  const created = await responseJson(await fetch(`${APP_URL}/api/petshop/appointments`, {
    method: 'POST',
    headers: headers(cookie, true),
    body: JSON.stringify(payload),
  }), `CREATE_APPOINTMENT_${index}`)
  const appointment = created?.appointment
  if (!appointment?.id || appointment.status !== 'concluido') throw new Error(`APPOINTMENT_${index}_NOT_COMPLETED`)
  manifest.appointments.push({ id: appointment.id, operation_key: payload.idempotency_key, service, scheduled_at: scheduledAt })
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  if (machineNo !== null) {
    await compat(cookie, {
      table: 'appointments',
      action: 'update',
      payload: { grooming_machine_no: machineNo },
      filters: [{ op: 'eq', column: 'id', value: appointment.id }],
      mode: 'single',
    }, `SET_MACHINE_${index}`)
  }
  return appointment.id
}

async function readAppointment(cookie, appointmentId) {
  return responseJson(await fetch(`${APP_URL}/api/petshop/appointments/${encodeURIComponent(appointmentId)}`, {
    headers: headers(cookie),
  }), `READ_APPOINTMENT_${appointmentId}`)
}

async function main() {
  const cookie = await authenticate()
  const suffix = compactId()
  const marker = `CODEX_REGRESSION_${new Date().toISOString().slice(0, 10)}_${suffix}`
  const manifest = {
    environment: 'production',
    tenant_id: TENANT_ID,
    module_id: MODULE_ID,
    marker,
    client_id: null,
    pet_id: null,
    appointments: [],
  }
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const catalog = await compat(cookie, {
    table: 'petshop_services',
    action: 'select',
    filters: [],
    order: [{ column: 'name', ascending: true }],
    limit: 1000,
  }, 'SERVICE_CATALOG')
  const services = Array.isArray(catalog?.data) ? catalog.data : []
  const selected = {
    machine: pickService(services, 'tosa_maquina', (name) => name.includes('tosa') && name.includes('maquina')),
    scissors: pickService(services, 'tosa_tesoura', (name) => name.includes('tosa') && name.includes('tesoura')),
    details: pickService(services, 'tosa_detalhes', (name) => name.includes('tosa') && name.includes('detalh') && !name.includes('maquina') && !name.includes('tesoura')),
    nail: pickService(services, 'corte_unha', (name) => name.includes('unha')),
  }

  const clientResult = await responseJson(await fetch(`${APP_URL}/api/petshop/clients`, {
    method: 'POST',
    headers: headers(cookie, true),
    body: JSON.stringify({
      owner_name: `Teste Regressao ${suffix}`,
      pet_name: `Pet Teste ${suffix}`,
      species: 'dog',
      weight_kg: 8,
      client_notes: marker,
      notes: marker,
    }),
  }), 'CREATE_CLIENT')
  manifest.pet_id = clientResult?.client?.id
  manifest.client_id = clientResult?.client?.tutor_group_id
  if (!manifest.pet_id || !manifest.client_id) throw new Error('CLIENT_IDS_MISSING')
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  await createAppointment(cookie, manifest, selected.machine, 0, 4)
  await createAppointment(cookie, manifest, selected.scissors, 1)
  await createAppointment(cookie, manifest, selected.details, 2)
  const nailAppointmentId = await createAppointment(cookie, manifest, selected.nail, 3)

  const assigned = await responseJson(await fetch(`${APP_URL}/api/petshop/appointments/${encodeURIComponent(nailAppointmentId)}/responsible`, {
    method: 'PATCH',
    headers: headers(cookie, true),
    body: JSON.stringify({
      responsible_staff_key: `regression-${suffix}`,
      responsible_staff_name: `Teste Regressao ${suffix}`,
    }),
  }), 'ASSIGN_RESPONSIBLE')
  if (assigned?.appointment?.responsible_staff_key !== `regression-${suffix}`) throw new Error('RESPONSIBLE_NOT_PERSISTED')

  const reads = []
  for (const item of manifest.appointments) {
    const body = await readAppointment(cookie, item.id)
    reads.push(body.appointment)
  }
  const machine = reads.find((item) => item.id === manifest.appointments[0].id)
  const nonMachine = reads.filter((item) => item.id !== manifest.appointments[0].id)
  if (machine?.grooming_machine_no !== 4) throw new Error('MACHINE_NUMBER_NOT_PERSISTED')
  if (nonMachine.some((item) => item.grooming_machine_no != null)) throw new Error('NON_MACHINE_HAS_MACHINE_NUMBER')
  if (reads.find((item) => item.id === nailAppointmentId)?.responsible_staff_key !== `regression-${suffix}`) {
    throw new Error('RESPONSIBLE_READBACK_FAILED')
  }

  console.log(JSON.stringify({
    status: 'production-regression-data-created',
    tenant_id: TENANT_ID,
    marker,
    created: { clients: 1, pets: 1, appointments: manifest.appointments.length },
    assertions: {
      machine_number_only_on_machine_service: 'passed',
      scissors_without_machine_number: 'passed',
      details_without_machine_number: 'passed',
      nail_cut_without_machine_number: 'passed',
      completed_responsible_assignment: 'passed',
      authenticated_native_readback: 'passed',
    },
    selected_services: Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, { code: value.code, name: value.name }])),
    manifest: MANIFEST_FILE,
  }))
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'production-regression-failed', error: String(error?.message || error), manifest: MANIFEST_FILE }))
  process.exitCode = 1
})
