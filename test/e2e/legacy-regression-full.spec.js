import { expect, test } from '@playwright/test'

const MODULE_ID = 'petshop'
const required = [
  'E2E_EMAIL', 'E2E_PASSWORD', 'E2E_TENANT_ID', 'E2E_CLIENT_ID',
  'E2E_PET_SMALL_ID', 'E2E_PET_MEDIUM_ID', 'E2E_SUBSCRIPTION_ID',
]

function must(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`LEGACY_REGRESSION_ENV_MISSING:${name}`)
  return value
}

function scopeHeaders() {
  return { 'x-tenant-id': must('E2E_TENANT_ID'), 'x-module-id': MODULE_ID }
}

function tomorrowDateKey() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(tomorrow)
}

function localClock(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))
}

async function signIn(page) {
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

async function browserRequest(page, path, { method = 'GET', headers = {}, data } = {}) {
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

async function compat(page, body) {
  return browserRequest(page, '/api/compat/query', { method: 'POST', headers: scopeHeaders(), data: body })
}

async function appointmentById(page, appointmentId) {
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

async function latestAppointmentForPet(page, petId) {
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

async function gotoAgenda(page) {
  await page.goto('/petshop/agenda', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 10_000 })
}

async function gotoTomorrowAgenda(page) {
  await gotoAgenda(page)
  await page.getByLabel('Próximo dia').click()
  await expect(page.locator('.page')).toBeVisible()
}

async function selectTutorPet(page, petName) {
  const search = page.getByLabel('Buscar cliente ou pet')
  await expect(search).toBeVisible({ timeout: 8_000 })
  await search.fill('Tutor Regressao')
  const tutorOption = page.getByRole('option').filter({ hasText: 'Tutor Regressao' }).first()
  await expect(tutorOption).toBeVisible({ timeout: 8_000 })
  await tutorOption.click()
  await expect(page.getByText('Escolha o pet para este agendamento')).toBeVisible()
  await page.getByRole('button', { name: new RegExp(petName, 'i') }).click()
}

async function selectService(page, serviceName) {
  const input = page.getByLabel('Buscar servico para adicionar')
  await input.fill(serviceName)
  const option = page.getByRole('option').filter({ hasText: serviceName }).first()
  await expect(option).toBeVisible({ timeout: 8_000 })
  await option.click()
}

async function createAppointmentFromCurrentAgenda(page, {
  petName = 'Theo QA', petId = must('E2E_PET_MEDIUM_ID'), serviceName = 'Banho Medio QA',
  time, notes = '', transport = 'cliente_leva',
}) {
  await page.getByRole('button', { name: /Novo Agendamento/i }).first().click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()
  await selectTutorPet(page, petName)
  await selectService(page, serviceName)
  await page.getByLabel('Data do agendamento').fill(tomorrowDateKey())
  await page.getByLabel('Horario do agendamento').fill(time)
  await page.getByLabel('Transporte do pet').selectOption(transport)
  if (notes) await page.getByLabel('Observacoes do agendamento').fill(notes)
  await page.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toHaveCount(0, { timeout: 10_000 })
  return latestAppointmentForPet(page, petId)
}

async function createAppointment(page, options) {
  await gotoAgenda(page)
  const created = await createAppointmentFromCurrentAgenda(page, options)
  await page.getByLabel('Próximo dia').click()
  return created
}

function cardFor(page, appointmentId) {
  return page.locator(`[data-yuisync-native-appointment-id="${appointmentId}"]`)
}

async function moveCardTo(page, appointmentId, time) {
  const card = cardFor(page, appointmentId)
  const slot = page.locator(`button[aria-label="Agendar as ${time}"]`)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(slot).toBeVisible({ timeout: 10_000 })
  const from = await card.boundingBox()
  const to = await slot.boundingBox()
  expect(from).toBeTruthy()
  expect(to).toBeTruthy()
  await page.mouse.move(from.x + from.width / 2, from.y + Math.min(24, from.height / 2))
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(12, to.height / 2), { steps: 12 })
  await page.mouse.up()
  await expect(page.getByText(new RegExp(`movido para ${time.replace(':', '\\:')}`, 'i'))).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText(time, { timeout: 10_000 })
}

async function actionButton(page, appointmentId, action) {
  const card = cardFor(page, appointmentId)
  await expect(card).toBeVisible({ timeout: 10_000 })
  const button = card.locator(`[data-yuisync-action="${action}"]`)
  await expect(button).toBeVisible({ timeout: 10_000 })
  return button
}

async function assertNoInvalidCardGeometry(cards) {
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

let overlapIds = []

test.describe.serial('full legacy acceptance - Agenda through Chromium UI', () => {
  test.beforeAll(() => {
    const missing = required.filter((name) => !process.env[name])
    if (missing.length) throw new Error(`LEGACY_REGRESSION_ENV_MISSING:${missing.join(',')}`)
  })

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('AG-01 - criar e editar pela UI mantém um único card/estado persistido', async ({ page }) => {
    const created = await createAppointment(page, { time: '08:10', notes: 'ag01 inicial' })
    const card = cardFor(page, created.id)
    await expect(card).toHaveCount(1)
    await card.locator('button.yuisync-card-content').click()
    await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeVisible()
    await page.getByLabel('Observacoes do agendamento').fill('AG01 EDITADO PELO NAVEGADOR')
    await page.getByRole('button', { name: 'Salvar alteracoes' }).click()
    await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toHaveCount(0, { timeout: 10_000 })
    await expect(cardFor(page, created.id)).toHaveCount(1)
    const persisted = await appointmentById(page, created.id)
    expect(persisted.notes).toBe('AG01 EDITADO PELO NAVEGADOR')
  })

  test('AG-02 - ativo e concluído do mesmo pet/horário mantêm ações no card correto', async ({ page }) => {
    const first = await createAppointment(page, { time: '08:20', notes: 'AG02 concluido' })
    await gotoAgenda(page)
    await createAppointmentFromCurrentAgenda(page, { time: '08:20', notes: 'AG02 ativo' })
    const second = await latestAppointmentForPet(page, must('E2E_PET_MEDIUM_ID'))
    await page.getByLabel('Próximo dia').click()
    const firstComplete = await actionButton(page, first.id, 'complete')
    page.once('dialog', (dialog) => dialog.accept())
    await firstComplete.click()
    await expect.poll(async () => (await appointmentById(page, first.id)).status, { timeout: 10_000 }).toBe('concluido')
    await gotoTomorrowAgenda(page)
    const completed = cardFor(page, first.id)
    const active = cardFor(page, second.id)
    await expect(completed).toBeVisible()
    await expect(active).toBeVisible()
    await expect(completed.locator('[data-yuisync-action="complete"]')).toHaveCount(0)
    await expect(completed.locator('[data-yuisync-action="cancel"]')).toHaveCount(0)
    await expect(active.locator('[data-yuisync-action="complete"]')).toBeVisible()
    await expect(active.locator('[data-yuisync-action="cancel"]')).toBeVisible()
    expect((await appointmentById(page, first.id)).status).toBe('concluido')
    expect((await appointmentById(page, second.id)).status).not.toBe('concluido')
  })

  test('AG-03 - criação e drag atualizam UI e D1 sem F5', async ({ page }) => {
    const created = await createAppointment(page, { time: '08:30', notes: 'AG03 drag' })
    await moveCardTo(page, created.id, '08:50')
    const persisted = await appointmentById(page, created.id)
    expect(localClock(persisted.scheduled_at)).toBe('08:50')
    await expect(cardFor(page, created.id)).toBeVisible()
  })

  test('AG-04 - criar/cancelar/concluir/mover não apaga os outros cards durante sincronização', async ({ page }) => {
    const moving = await createAppointment(page, { time: '09:00', notes: 'AG04 moving' })
    await gotoAgenda(page)
    await createAppointmentFromCurrentAgenda(page, { time: '09:10', notes: 'AG04 sentinel' })
    const sentinel = await latestAppointmentForPet(page, must('E2E_PET_MEDIUM_ID'))
    await page.getByLabel('Próximo dia').click()
    await expect(cardFor(page, sentinel.id)).toBeVisible()

    await page.evaluate((sentinelId) => {
      const selector = `[data-yuisync-native-appointment-id="${sentinelId}"]`
      window.__ag04LostSentinel = false
      window.__ag04Observer?.disconnect?.()
      const check = () => {
        if (!document.querySelector(selector)) window.__ag04LostSentinel = true
      }
      window.__ag04Observer = new MutationObserver(check)
      window.__ag04Observer.observe(document.querySelector('.page') || document.body, { childList: true, subtree: true })
    }, sentinel.id)

    await moveCardTo(page, moving.id, '09:20')
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)

    const cancel = await actionButton(page, moving.id, 'cancel')
    await cancel.click()
    await expect(cardFor(page, moving.id)).toHaveCount(0, { timeout: 10_000 })
    await expect(cardFor(page, sentinel.id)).toBeVisible()
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)

    await createAppointmentFromCurrentAgenda(page, {
      petName: 'Nina QA', petId: must('E2E_PET_SMALL_ID'), serviceName: 'Banho Pequeno QA',
      time: '15:00', notes: 'AG04 pacote zero',
    })
    const packageAppointment = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    await expect(cardFor(page, packageAppointment.id)).toBeVisible({ timeout: 10_000 })
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)

    const complete = await actionButton(page, packageAppointment.id, 'complete')
    const popupPromise = page.waitForEvent('popup', { timeout: 2_000 }).catch(() => null)
    page.once('dialog', (dialog) => dialog.accept())
    await complete.click()
    const popup = await popupPromise
    if (popup) await popup.close().catch(() => {})
    await expect(cardFor(page, sentinel.id)).toBeVisible({ timeout: 10_000 })
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)
    expect((await appointmentById(page, packageAppointment.id)).status).toBe('concluido')
    await page.evaluate(() => window.__ag04Observer?.disconnect?.())
  })

  test('AG-05 - drag com 1/2/3+ cards recalcula coluna e largura', async ({ page }) => {
    const a = await createAppointment(page, { time: '09:30', notes: 'AG05-A' })
    await gotoAgenda(page)
    await createAppointmentFromCurrentAgenda(page, { time: '09:30', notes: 'AG05-B' })
    const b = await latestAppointmentForPet(page, must('E2E_PET_MEDIUM_ID'))
    await createAppointmentFromCurrentAgenda(page, { time: '09:30', notes: 'AG05-C' })
    const c = await latestAppointmentForPet(page, must('E2E_PET_MEDIUM_ID'))
    await page.getByLabel('Próximo dia').click()
    const cluster = page.locator('.yuisync-resolved-card').filter({ hasText: 'Theo QA' }).filter({ hasText: '09:30' })
    await expect(cluster).toHaveCount(3, { timeout: 10_000 })
    await assertNoInvalidCardGeometry(cluster)
    await moveCardTo(page, c.id, '09:50')
    await expect(page.locator('.yuisync-resolved-card').filter({ hasText: 'Theo QA' }).filter({ hasText: '09:30' })).toHaveCount(2)
    await expect(cardFor(page, c.id)).toContainText('09:50')
    await assertNoInvalidCardGeometry(page.locator(`[data-yuisync-native-appointment-id="${a.id}"], [data-yuisync-native-appointment-id="${b.id}"], [data-yuisync-native-appointment-id="${c.id}"]`))
  })

  test('AG-06 - Agenda suporta progressivamente 1, 2, 3, 4 e 5 atendimentos simultâneos', async ({ page }) => {
    await gotoTomorrowAgenda(page)
    overlapIds = []
    for (let count = 1; count <= 5; count += 1) {
      const created = await createAppointmentFromCurrentAgenda(page, { time: '13:20', notes: `AG06 overlap ${count}` })
      overlapIds.push(created.id)
      const cards = page.locator('.yuisync-resolved-card').filter({ hasText: 'Theo QA' }).filter({ hasText: '13:20' })
      await expect(cards).toHaveCount(count, { timeout: 10_000 })
      await assertNoInvalidCardGeometry(cards)
      const densities = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.yuisyncDensity || ''))
      expect(densities.every(Boolean)).toBe(true)
    }
  })

  test('AG-07 - todos os cards coincidentes continuam acessíveis e operáveis', async ({ page }) => {
    expect(overlapIds).toHaveLength(5)
    await gotoTomorrowAgenda(page)
    for (const id of overlapIds) {
      const card = cardFor(page, id)
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card.locator('button.yuisync-card-content')).toBeVisible()
      await expect(card.locator('[data-yuisync-action="cancel"]')).toBeVisible()
      await expect(card.locator('[data-yuisync-action="print"]')).toBeVisible()
      await expect(card.locator('[data-yuisync-action="complete"]')).toBeVisible()
    }
  })

  test('AG-09 - ações do card seguem cancelar → imprimir → concluir', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(1)
    await gotoTomorrowAgenda(page)
    const actions = cardFor(page, overlapIds[0]).locator('[data-yuisync-resolved-actions] [data-yuisync-action]')
    await expect(actions).toHaveCount(3)
    expect(await actions.evaluateAll((nodes) => nodes.map((node) => node.dataset.yuisyncAction))).toEqual(['cancel', 'print', 'complete'])
  })

  test('AG-10 - cancelar pela UI preserva a linha e grava status cancelado', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(1)
    const id = overlapIds[0]
    await gotoTomorrowAgenda(page)
    await (await actionButton(page, id, 'cancel')).click()
    await expect(cardFor(page, id)).toHaveCount(0, { timeout: 10_000 })
    const persisted = await appointmentById(page, id)
    expect(persisted.id).toBe(id)
    expect(persisted.status).toBe('cancelado')
  })

  test('AG-11 - concluído não pode ser arrastado nem concluído novamente', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(2)
    const id = overlapIds[1]
    await gotoTomorrowAgenda(page)
    page.once('dialog', (dialog) => dialog.accept())
    await (await actionButton(page, id, 'complete')).click()
    await expect.poll(async () => (await appointmentById(page, id)).status, { timeout: 10_000 }).toBe('concluido')
    await gotoTomorrowAgenda(page)
    const card = cardFor(page, id)
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card).toHaveAttribute('data-yuisync-movable', 'false')
    await expect(card.locator('[data-yuisync-action="complete"]')).toHaveCount(0)
    await expect(card.locator('[data-yuisync-action="cancel"]')).toHaveCount(0)
    expect((await appointmentById(page, id)).status).toBe('concluido')
  })

  test('AG-12 - concluir exige confirmação e cancelar a confirmação não altera estado', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(3)
    const id = overlapIds[2]
    await gotoTomorrowAgenda(page)
    const before = await appointmentById(page, id)
    let nativeDialogSeen = false
    page.once('dialog', async (dialog) => {
      nativeDialogSeen = true
      await dialog.dismiss()
    })
    await (await actionButton(page, id, 'complete')).click()
    await page.waitForTimeout(300)
    const customConfirm = page.getByRole('dialog').filter({ hasText: /concluir|confirma/i }).first()
    const customVisible = await customConfirm.isVisible().catch(() => false)
    if (customVisible) {
      const cancel = customConfirm.getByRole('button', { name: /cancelar|voltar|não/i }).first()
      await expect(cancel).toBeVisible()
      await cancel.click()
    }
    expect(nativeDialogSeen || customVisible, 'AG-12 exige uma confirmação antes de concluir').toBe(true)
    const after = await appointmentById(page, id)
    expect(after.status).toBe(before.status)
  })
})
