import { expect, test } from '@playwright/test'

const MODULE_ID = 'petshop'
const routes = [
  '/petshop/dashboard',
  '/petshop/agenda',
  '/petshop/vendas',
  '/petshop/ordens',
  '/petshop/chat',
  '/petshop/growth',
  '/petshop/pets',
  '/petshop/fidelidade',
  '/petshop/caixa',
  '/petshop/relatorios',
  '/petshop/planos',
  '/petshop/financeiro',
  '/petshop/estoque',
  '/petshop/campanhas',
  '/petshop/usuarios',
  '/petshop/equipe',
  '/petshop/config',
  '/petshop/logs',
]

const required = [
  'E2E_EMAIL', 'E2E_PASSWORD', 'E2E_TENANT_ID', 'E2E_CLIENT_ID',
  'E2E_PET_SMALL_ID', 'E2E_PET_MEDIUM_ID', 'E2E_PET_CAT_ID',
  'E2E_SERVICE_SMALL_ID', 'E2E_SERVICE_SMALL_CODE',
  'E2E_SERVICE_MEDIUM_ID', 'E2E_SERVICE_MEDIUM_CODE',
  'E2E_SERVICE_LARGE_ID', 'E2E_SERVICE_LARGE_CODE',
  'E2E_SERVICE_CAT_ID', 'E2E_SERVICE_CAT_CODE',
  'E2E_PRODUCT_ID', 'E2E_SUBSCRIPTION_ID', 'E2E_FOREIGN_TENANT_ID',
]

function must(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`LEGACY_REGRESSION_ENV_MISSING:${name}`)
  return value
}

function scopeHeaders(tenantId = must('E2E_TENANT_ID')) {
  return { 'x-tenant-id': tenantId, 'x-module-id': MODULE_ID }
}

function tomorrowDateKey() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrow)
}

async function signIn(page) {
  await page.goto('/entrar', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('E-mail', { exact: true }).fill(must('E2E_EMAIL'))
  await page.getByLabel('Senha', { exact: true }).fill(must('E2E_PASSWORD'))
  const submit = page.locator('form button[type="submit"]')
  await expect(submit).toBeVisible({ timeout: 10_000 })
  await submit.click({ timeout: 10_000 })
  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 10_000 })
  await page.evaluate(({ tenantId, moduleId }) => {
    localStorage.setItem('@yui_active_tenant', tenantId)
    localStorage.setItem('@app_module', moduleId)
  }, { tenantId: must('E2E_TENANT_ID'), moduleId: MODULE_ID })
}

async function browserRequest(page, path, { method = 'GET', headers = {}, data } = {}) {
  const result = await page.evaluate(async ({ path, method, headers, data }) => {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: {
        ...headers,
        ...(data === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    const text = await response.text()
    let payload = {}
    if (text) {
      try { payload = JSON.parse(text) } catch { payload = { raw: text } }
    }
    return { status: response.status, payload }
  }, { path, method, headers, data })

  return {
    status: () => result.status,
    json: async () => result.payload,
  }
}

async function compat(page, body, tenantId = must('E2E_TENANT_ID')) {
  const response = await browserRequest(page, '/api/compat/query', {
    method: 'POST',
    headers: scopeHeaders(tenantId),
    data: body,
  })
  const payload = await response.json()
  return { response, payload }
}

async function rpc(page, name, args, tenantId = must('E2E_TENANT_ID')) {
  const response = await browserRequest(page, '/api/compat/rpc', {
    method: 'POST',
    headers: scopeHeaders(tenantId),
    data: { name, args },
  })
  const payload = await response.json()
  return { response, payload }
}

async function selectTutorPet(page, petName) {
  const search = page.getByPlaceholder('Buscar cliente, pet ou telefone...')
  await expect(search).toBeVisible({ timeout: 8_000 })
  await search.fill('Tutor Regressao')
  await expect(page.getByText('Tutor Regressao', { exact: true }).first()).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Escolher pet' }).click()
  await expect(page.getByText('Escolha o pet para este agendamento')).toBeVisible()
  await page.getByRole('button', { name: new RegExp(petName, 'i') }).click()
}

async function selectService(page, serviceName) {
  const input = page.locator('input[placeholder="Buscar e adicionar servico..."]')
  await input.fill(serviceName)
  const option = page.getByRole('option').filter({ hasText: serviceName }).first()
  await expect(option).toBeVisible({ timeout: 8_000 })
  await option.click()
}

async function openNewAppointment(page) {
  await page.goto('/petshop/agenda', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Novo Agendamento/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()
}

async function latestAppointmentForPet(page, petId) {
  const { response, payload } = await compat(page, {
    table: 'appointments', action: 'select', columns: '*',
    filters: [
      { op: 'eq', column: 'pet_id', value: petId },
      { op: 'eq', column: 'tenant_id', value: must('E2E_TENANT_ID') },
      { op: 'eq', column: 'module_id', value: MODULE_ID },
    ],
    orders: [{ column: 'created_at', ascending: false }],
    limit: 1, mode: 'maybeSingle',
  })
  expect(response.status(), JSON.stringify(payload)).toBe(200)
  expect(payload.data).toBeTruthy()
  return payload.data
}

let packageAppointmentId = ''
let packageAppointment = null
let checkoutSaleId = ''

test.describe.serial('legacy incident staging browser matrix', () => {
  test.beforeAll(() => {
    const missing = required.filter((name) => !process.env[name])
    if (missing.length) throw new Error(`LEGACY_REGRESSION_ENV_MISSING:${missing.join(',')}`)
  })

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('01 - rotas historicamente criticas abrem sem erro de UI/API', async ({ page }) => {
    const consoleErrors = []
    const pageErrors = []
    const apiErrors = []
    const networkErrors = []

    page.on('console', (message) => {
      if (message.type() !== 'error') return
      if (/Failed to fetch/i.test(message.text())) return
      consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.pathname.startsWith('/api/') && response.status() >= 400) {
        apiErrors.push(`${response.status()} ${response.request().method()} ${url.pathname}`)
      }
    })
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || 'unknown-network-error'
      if (failure === 'net::ERR_ABORTED') return
      const url = new URL(request.url())
      networkErrors.push(`${failure} ${request.method()} ${url.pathname}`)
    })

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('main h1, main h2').first(), route).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Falha ao carregar esta aba')).toHaveCount(0)
    }

    expect(apiErrors).toEqual([])
    expect(networkErrors).toEqual([])
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('02 - cadastro simulado preserva tutor com multiplos pets e busca', async ({ page }) => {
    await page.goto('/petshop/pets', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Tutor Regressao').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Nina QA').first()).toBeVisible()
    await expect(page.getByText('Theo QA').first()).toBeVisible()
    await expect(page.getByText('Mia QA').first()).toBeVisible()

    const search = page.locator('input[placeholder*="Buscar"]').first()
    if (await search.count()) {
      await search.fill('Theo QA')
      await expect(page.getByText('Theo QA').first()).toBeVisible()
    }
  })

  test('03 - isolamento de tenant bloqueia leitura cruzada', async ({ page }) => {
    const { response, payload } = await compat(page, {
      table: 'clients', action: 'select', columns: '*', filters: [], limit: 10, mode: 'many',
    }, must('E2E_FOREIGN_TENANT_ID'))
    expect([403, 404], JSON.stringify(payload)).toContain(response.status())
    expect(payload?.data ?? null).toBeNull()
  })

  test('04 - agenda cria limite pequeno com pacote, snapshots e MotoDog explicitos', async ({ page }) => {
    await openNewAppointment(page)
    await selectTutorPet(page, 'Nina QA')
    await selectService(page, 'Banho Pequeno QA')
    await page.getByLabel('Data do agendamento').fill(tomorrowDateKey())
    await page.getByLabel('Horario do agendamento').fill('10:00')
    await page.getByLabel('Transporte do pet').selectOption('buscar_e_levar')
    await page.locator('input[placeholder="Rua, numero e complemento"]').fill('Rua QA, 123')
    await page.getByLabel('Observacoes do agendamento').fill('Regressao E2E: pequeno + pacote + MotoDog')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toHaveCount(0, { timeout: 10_000 })

    packageAppointment = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    packageAppointmentId = String(packageAppointment.id)
    expect(packageAppointment.subscription_id).toBe(must('E2E_SUBSCRIPTION_ID'))
    expect(['reserved', 'consumed']).toContain(String(packageAppointment.subscription_benefit_status))
    expect(packageAppointment.transport_mode).toBe('buscar_e_levar')
    expect(String(packageAppointment.transport_address || '')).toContain('Rua QA')

    const items = Array.isArray(packageAppointment.service_items)
      ? packageAppointment.service_items
      : JSON.parse(packageAppointment.service_items || '[]')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ code: must('E2E_SERVICE_SMALL_CODE'), species_target: 'dog' })
    expect(Number(items[0].catalog_price)).toBe(55)
    expect(Number(items[0].commission_rate)).toBe(5)
    expect(Number(items[0].min_weight_kg)).toBe(0)
    expect(Number(items[0].max_weight_kg)).toBeCloseTo(10.099, 3)
  })

  test('05 - peso 10.100 rejeita faixa pequena e aceita faixa media', async ({ page }) => {
    await openNewAppointment(page)
    await selectTutorPet(page, 'Theo QA')
    await selectService(page, 'Banho Pequeno QA')
    await page.getByLabel('Data do agendamento').fill(tomorrowDateKey())
    await page.getByLabel('Horario do agendamento').fill('11:00')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByText(/faixa de peso/i)).toBeVisible({ timeout: 10_000 })
    await page.getByLabel('Fechar agendamento').click()

    await openNewAppointment(page)
    await selectTutorPet(page, 'Theo QA')
    await selectService(page, 'Banho Medio QA')
    await page.getByLabel('Data do agendamento').fill(tomorrowDateKey())
    await page.getByLabel('Horario do agendamento').fill('11:00')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toHaveCount(0, { timeout: 10_000 })

    const appointment = await latestAppointmentForPet(page, must('E2E_PET_MEDIUM_ID'))
    const items = Array.isArray(appointment.service_items) ? appointment.service_items : JSON.parse(appointment.service_items || '[]')
    expect(items[0].code).toBe(must('E2E_SERVICE_MEDIUM_CODE'))
    expect(Number(items[0].min_weight_kg)).toBeCloseTo(10.1, 3)
  })

  test('06 - especie gato rejeita servico configurado para cao', async ({ page }) => {
    await openNewAppointment(page)
    await selectTutorPet(page, 'Mia QA')
    await selectService(page, 'Banho Pequeno QA')
    await page.getByLabel('Data do agendamento').fill(tomorrowDateKey())
    await page.getByLabel('Horario do agendamento').fill('12:00')
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(page.getByText(/espécie|especie/i)).toBeVisible({ timeout: 10_000 })
    await page.getByLabel('Fechar agendamento').click()
  })

  test('07 - edicao somente de MotoDog nao altera servico/pacote', async ({ page }) => {
    expect(packageAppointmentId).toBeTruthy()
    await page.goto('/petshop/agenda', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Próximo dia').click()
    const card = page.locator(`[data-yuisync-native-appointment-id="${packageAppointmentId}"]`)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText(/MotoDog|buscar/i)
    await card.locator('button.yuisync-card-content').click()
    await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeVisible()
    await page.getByLabel('Transporte do pet').selectOption('somente_levar')
    await page.locator('input[placeholder="Rua, numero e complemento"]').fill('Avenida QA, 456')
    await page.getByRole('button', { name: 'Salvar alteracoes' }).click()
    await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toHaveCount(0, { timeout: 10_000 })

    const after = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    expect(after.transport_mode).toBe('somente_levar')
    expect(String(after.transport_address || '')).toContain('Avenida QA')
    const beforeItems = Array.isArray(packageAppointment.service_items) ? packageAppointment.service_items : JSON.parse(packageAppointment.service_items || '[]')
    const afterItems = Array.isArray(after.service_items) ? after.service_items : JSON.parse(after.service_items || '[]')
    expect(afterItems.map((item) => item.code)).toEqual(beforeItems.map((item) => item.code))
    expect(after.subscription_id).toBe(packageAppointment.subscription_id)
  })

  test('08 - conclusao e replay consomem beneficio exatamente uma vez', async ({ page }) => {
    expect(packageAppointmentId).toBeTruthy()
    const filters = [
      { op: 'eq', column: 'id', value: packageAppointmentId },
      { op: 'eq', column: 'tenant_id', value: must('E2E_TENANT_ID') },
      { op: 'eq', column: 'module_id', value: MODULE_ID },
    ]
    const first = await compat(page, { table: 'appointments', action: 'update', payload: { status: 'concluido' }, filters, mode: 'many' })
    expect(first.response.status(), JSON.stringify(first.payload)).toBe(200)
    const completed = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    expect(completed.status).toBe('concluido')
    expect(completed.subscription_id).toBe(must('E2E_SUBSCRIPTION_ID'))
    expect(completed.subscription_benefit_status).toBe('consumed')

    const usageBefore = await compat(page, {
      table: 'client_subscriptions', action: 'select', columns: '*',
      filters: [{ op: 'eq', column: 'id', value: must('E2E_SUBSCRIPTION_ID') }], mode: 'maybeSingle', limit: 1,
    })
    expect(usageBefore.response.status()).toBe(200)
    const usedBefore = JSON.stringify(usageBefore.payload.data?.services_used || usageBefore.payload.data?.services_used_json || {})

    const replay = await compat(page, { table: 'appointments', action: 'update', payload: { status: 'concluido' }, filters, mode: 'many' })
    expect(replay.response.status(), JSON.stringify(replay.payload)).toBe(200)
    const usageAfter = await compat(page, {
      table: 'client_subscriptions', action: 'select', columns: '*',
      filters: [{ op: 'eq', column: 'id', value: must('E2E_SUBSCRIPTION_ID') }], mode: 'maybeSingle', limit: 1,
    })
    expect(usageAfter.response.status()).toBe(200)
    const usedAfter = JSON.stringify(usageAfter.payload.data?.services_used || usageAfter.payload.data?.services_used_json || {})
    expect(usedAfter).toBe(usedBefore)
  })

  test('09 - reabrir atendimento consumido libera pacote sem consumo fantasma', async ({ page }) => {
    const current = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    const serviceItems = Array.isArray(current.service_items) ? current.service_items : JSON.parse(current.service_items || '[]')
    const reopened = await rpc(page, 'update_petshop_appointment_transaction', {
      p_appointment_id: packageAppointmentId,
      p_payload: {
        tenant_id: must('E2E_TENANT_ID'), module_id: MODULE_ID,
        client_id: must('E2E_CLIENT_ID'), pet_id: must('E2E_PET_SMALL_ID'),
        service_type: must('E2E_SERVICE_SMALL_CODE'), service_group: 'banho_tosa',
        service_items: serviceItems, scheduled_at: current.scheduled_at,
        duration_min: Number(current.duration_min || 60), price: Number(current.price || 0),
        status: 'agendado', source: 'manual',
      },
    })
    expect(reopened.response.status(), JSON.stringify(reopened.payload)).toBe(200)
    expect(reopened.payload.data?.reopened).toBe(true)
    expect(reopened.payload.data?.package_released).toBe(true)

    const after = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    expect(after.status).toBe('agendado')
    expect(after.subscription_benefit_status).toBe('released')
    expect(Number(after.subscription_benefit_used || 0)).toBe(0)
  })

  test('10 - checkout PDV e replay sao atomicos e idempotentes', async ({ page }) => {
    const idempotencyKey = `legacy-regression:${must('E2E_PRODUCT_ID')}`
    const body = {
      tenantId: must('E2E_TENANT_ID'), moduleId: MODULE_ID, clientId: must('E2E_CLIENT_ID'),
      customerName: 'Tutor Regressao', source: 'pos', fulfillmentType: 'counter', discount: 0,
      idempotencyKey, items: [{ productId: must('E2E_PRODUCT_ID'), quantity: 1 }], paymentMethod: 'pix',
    }
    const first = await browserRequest(page, '/api/petshop/checkout', { method: 'POST', data: body })
    const firstPayload = await first.json()
    expect(first.status(), JSON.stringify(firstPayload)).toBe(201)
    expect(firstPayload.success).toBe(true)
    expect(firstPayload.data.transaction.replayed).toBe(false)
    checkoutSaleId = String(firstPayload.data.sale.id)

    const replay = await browserRequest(page, '/api/petshop/checkout', { method: 'POST', data: body })
    const replayPayload = await replay.json()
    expect(replay.status(), JSON.stringify(replayPayload)).toBe(200)
    expect(replayPayload.data.transaction.replayed).toBe(true)
    expect(String(replayPayload.data.sale.id)).toBe(checkoutSaleId)

    const sale = await compat(page, {
      table: 'sales', action: 'select', columns: '*',
      filters: [{ op: 'eq', column: 'id', value: checkoutSaleId }], mode: 'maybeSingle', limit: 1,
    })
    expect(sale.response.status()).toBe(200)
    expect(sale.payload.data).toBeTruthy()

    await page.goto('/petshop/vendas', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main h1, main h2').first()).toBeVisible()
    await page.goto('/petshop/estoque', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Racao E2E QA').first()).toBeVisible({ timeout: 10_000 })
    await page.goto('/petshop/caixa', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('main h1, main h2').first()).toBeVisible()
  })

  test('11 - readiness e realtime autenticado continuam operacionais', async ({ page }) => {
    const ready = await browserRequest(page, '/ready')
    expect(ready.status()).toBe(200)
    const body = await ready.json()
    expect(body.status).toBe('ready')
    expect(String(body.checks?.schema_version)).toBe('30')

    await page.goto('/petshop/dashboard', { waitUntil: 'domcontentloaded' })
    const realtime = await page.evaluate(({ tenantId, moduleId }) => new Promise((resolve) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/api/realtime?tenant_id=${encodeURIComponent(tenantId)}&module_id=${encodeURIComponent(moduleId)}`)
      const timer = setTimeout(() => { try { ws.close() } catch {}; resolve('timeout') }, 8000)
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || ''))
          if (payload?.type === 'realtime.system' && payload?.event === 'SUBSCRIBED') {
            clearTimeout(timer); ws.close(1000, 'e2e-complete'); resolve('subscribed')
          }
        } catch { /* wait for subscription envelope */ }
      }
      ws.onerror = () => { clearTimeout(timer); resolve('error') }
    }), { tenantId: must('E2E_TENANT_ID'), moduleId: MODULE_ID })
    expect(realtime).toBe('subscribed')
  })

  test('12 - paginas P0 nao criam overflow horizontal no viewport mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const route of ['/petshop/agenda', '/petshop/pets', '/petshop/vendas', '/petshop/planos', '/petshop/estoque']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('main h1, main h2').first()).toBeVisible({ timeout: 10_000 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      expect(overflow, route).toBe(false)
    }
  })
})