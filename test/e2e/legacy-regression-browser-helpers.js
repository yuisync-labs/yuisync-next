import { expect } from '@playwright/test'

export const MODULE_ID = 'petshop'

export function must(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`LEGACY_REGRESSION_ENV_MISSING:${name}`)
  return value
}

export function scopeHeaders() {
  return { 'x-tenant-id': must('E2E_TENANT_ID'), 'x-module-id': MODULE_ID }
}

export function tomorrowDateKey() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrow)
}

export function localClock(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))
}

export async function signIn(page) {
  await page.goto('/entrar', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('E-mail', { exact: true }).fill(must('E2E_EMAIL'))
  await page.getByLabel('Senha', { exact: true }).fill(must('E2E_PASSWORD'))
  await page.locator('form button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 10_000 })
  await page.evaluate(({ tenantId, moduleId }) => {
    localStorage.setItem('@yui_active_tenant', tenantId)
    localStorage.setItem('@app_module', moduleId)
  }, { tenantId: must('E2E_TENANT_ID'), moduleId: MODULE_ID })
}

export async function browserRequest(page, path, { method = 'GET', headers = {}, data } = {}) {
  return page.evaluate(async ({ path, method, headers, data }) => {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: { ...headers, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    const text = await response.text()
    let payload = {}
    if (text) {
      try { payload = JSON.parse(text) } catch { payload = { raw: text } }
    }
    return { status: response.status, payload }
  }, { path, method, headers, data })
}

export async function compat(page, body) {
  return browserRequest(page, '/api/compat/query', { method: 'POST', headers: scopeHeaders(), data: body })
}

export async function appointmentById(page, appointmentId) {
  const result = await compat(page, {
    table: 'appointments', action: 'select', columns: '*',
    filters: [
      { op: 'eq', column: 'id', value: appointmentId },
      { op: 'eq', column: 'tenant_id', value: must('E2E_TENANT_ID') },
      { op: 'eq', column: 'module_id', value: MODULE_ID },
    ],
    limit: 1, mode: 'maybeSingle',
  })
  expect(result.status, JSON.stringify(result.payload)).toBe(200)
  expect(result.payload.data).toBeTruthy()
  return result.payload.data
}

export async function latestAppointmentForPet(page, petId) {
  const result = await compat(page, {
    table: 'appointments', action: 'select', columns: '*',
    filters: [
      { op: 'eq', column: 'pet_id', value: petId },
      { op: 'eq', column: 'tenant_id', value: must('E2E_TENANT_ID') },
      { op: 'eq', column: 'module_id', value: MODULE_ID },
    ],
    orders: [{ column: 'created_at', ascending: false }],
    limit: 1, mode: 'maybeSingle',
  })
  expect(result.status, JSON.stringify(result.payload)).toBe(200)
  expect(result.payload.data).toBeTruthy()
  return result.payload.data
}

export async function gotoAgenda(page) {
  await page.goto('/petshop/agenda', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 10_000 })
}

export async function gotoTomorrowAgenda(page) {
  await gotoAgenda(page)
  await page.getByLabel('Próximo dia').click()
  await expect(page.locator('.page')).toBeVisible()
}

export async function selectTutorPet(page, petName) {
  const search = page.getByLabel('Buscar cliente ou pet')
  await expect(search).toBeVisible({ timeout: 8_000 })
  await search.fill('Tutor Regressao')
  const tutorOption = page.getByRole('option').filter({ hasText: 'Tutor Regressao' }).first()
  await expect(tutorOption).toBeVisible({ timeout: 8_000 })
  await tutorOption.click()
  await expect(page.getByText('Escolha o pet para este agendamento')).toBeVisible()
  await page.getByRole('button', { name: new RegExp(petName, 'i') }).click()
}

export async function selectService(page, serviceName) {
  const input = page.getByLabel('Buscar servico para adicionar')
  await input.fill(serviceName)
  const option = page.getByRole('option').filter({ hasText: serviceName }).first()
  await expect(option).toBeVisible({ timeout: 8_000 })
  await option.click()
}

export async function createAppointmentFromCurrentAgenda(page, {
  petName = 'Theo QA', petId = must('E2E_PET_MEDIUM_ID'), serviceName = 'Banho Medio QA',
  time, notes = '', transport = 'cliente_leva', duration,
}) {
  await page.getByRole('button', { name: /Novo Agendamento/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()
  await selectTutorPet(page, petName)
  await selectService(page, serviceName)
  await page.getByLabel('Data do agendamento').fill(tomorrowDateKey())
  await page.getByLabel('Horario do agendamento').fill(time)
  if (duration != null) await page.getByLabel('Duracao total do agendamento').fill(String(duration))
  await page.getByLabel('Transporte do pet').selectOption(transport)
  if (notes) await page.getByLabel('Observacoes do agendamento').fill(notes)
  await page.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toHaveCount(0, { timeout: 10_000 })
  return latestAppointmentForPet(page, petId)
}

export async function createAppointment(page, options) {
  await gotoAgenda(page)
  const created = await createAppointmentFromCurrentAgenda(page, options)
  await page.getByLabel('Próximo dia').click()
  return created
}

export function cardFor(page, appointmentId) {
  return page.locator(`[data-yuisync-native-appointment-id="${appointmentId}"]`)
}

export function historicalAppointmentRow(page, { time, petName, status = /Conclu/i }) {
  return page.locator('button').filter({ hasText: time }).filter({ hasText: petName }).filter({ hasText: status }).first()
}

export async function moveCardTo(page, appointmentId, time) {
  const card = cardFor(page, appointmentId)
  const slot = page.locator(`button[aria-label="Agendar as ${time}"]`)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(slot).toBeVisible({ timeout: 10_000 })
  const from = await card.boundingBox()
  const to = await slot.boundingBox()
  expect(from).toBeTruthy()
  expect(to).toBeTruthy()

  const sourcePoint = {
    x: from.x + from.width / 2,
    y: from.y + Math.min(24, from.height / 2),
  }
  const targetPoint = {
    x: to.x + to.width / 2,
    y: to.y + Math.min(12, to.height / 2),
  }

  // Use Playwright's native mouse input instead of synthetic PointerEvents.
  // The Agenda calls setPointerCapture() during drag, which only behaves like
  // production when the browser owns a real active pointer stream.
  await page.mouse.move(sourcePoint.x, sourcePoint.y)
  await page.mouse.down({ button: 'left' })
  try {
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 8 })
  } finally {
    await page.mouse.up({ button: 'left' })
  }

  await expect(page.getByText(new RegExp(`movido para ${time.replace(':', '\\:')}`, 'i'))).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText(time, { timeout: 10_000 })
}

export async function actionButton(page, appointmentId, action) {
  const card = cardFor(page, appointmentId)
  await expect(card).toBeVisible({ timeout: 10_000 })
  const button = card.locator(`[data-yuisync-action="${action}"]`)
  await expect(button).toBeVisible({ timeout: 10_000 })
  return button
}

export async function confirmAndClick(page, locator) {
  page.once('dialog', (dialog) => dialog.accept())
  await locator.click()
}

export async function assertNoInvalidCardGeometry(cards) {
  const rects = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }))
  expect(rects.length).toBeGreaterThan(0)
  for (const rect of rects) {
    expect(rect.width).toBeGreaterThan(20)
    expect(rect.height).toBeGreaterThan(20)
    expect(Number.isFinite(rect.x)).toBe(true)
    expect(Number.isFinite(rect.y)).toBe(true)
  }
}
