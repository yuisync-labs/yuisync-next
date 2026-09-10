import { expect, test } from '@playwright/test'

async function settlePage(page) {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText(/Sincronizando ambiente/i)).toHaveCount(0, { timeout: 30_000 })
}

async function signIn(page, email, password) {
  await page.goto('/entrar')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)

  const submit = page.locator('form button[type="submit"]')
  await expect(submit).toBeVisible({ timeout: 15_000 })
  await expect(submit).toBeEnabled({ timeout: 15_000 })
  await submit.click({ timeout: 15_000 })

  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 15_000 })
  await settlePage(page)
}

async function seedAgendaFixture(page, suffix) {
  return page.evaluate(async ({ suffix: seedSuffix }) => {
    const tenantId = localStorage.getItem('@yui_active_tenant')
    if (!tenantId) throw new Error('E2E_AGENDA_ACTIVE_TENANT_NOT_FOUND')

    const headers = {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    }
    const request = async (path, body) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(`E2E_AGENDA_SEED_FAILED:${response.status}:${path}:${payload.code || payload.message || 'unknown'}`)
      }
      return payload
    }

    const tutorName = `Agenda E2E Tutor ${seedSuffix}`
    const petName = `Agenda E2E Pet ${seedSuffix}`
    const serviceName = `Banho Agenda E2E ${seedSuffix}`
    const serviceCode = `agenda-e2e-${seedSuffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')

    const clientPayload = await request('/api/petshop/clients', {
      owner_name: tutorName,
      pet_name: petName,
      owner_cpf: '12345678909',
      phone: '11999990000',
      owner_address: 'Rua E2E, 100',
      owner_neighborhood: 'Centro',
      owner_city: 'Sao Paulo',
      species: 'dog',
      breed: 'SRD',
      weight_kg: 8.5,
    })
    const servicePayload = await request('/api/petshop/services', {
      code: serviceCode,
      name: serviceName,
      category: 'Banho e tosa',
      description: 'Fixture efemera da regressao hospedada da Agenda',
      group_type: 'banho_tosa',
      default_price: 0,
      default_duration_min: 60,
      commission_type: 'percentage',
      commission_rate: 0,
      sort_order: 1,
      active: true,
    })

    if (!clientPayload?.client?.id || !servicePayload?.service?.id) {
      throw new Error('E2E_AGENDA_SEED_INCOMPLETE')
    }

    return {
      tenantId,
      tutorName,
      petName,
      serviceName,
      clientId: clientPayload.client.id,
      serviceId: servicePayload.service.id,
    }
  }, { suffix })
}

function agendaCard(page, petName) {
  return page
    .locator('[data-yuisync-native-agenda-card="true"]')
    .filter({ hasText: petName })
    .first()
}

function movableAgendaCard(page, petName) {
  return page
    .locator('[data-yuisync-appointment-id][data-yuisync-movable="true"]')
    .filter({ hasText: petName })
    .first()
}

async function openAppointmentPanel(page, petName) {
  const card = agendaCard(page, petName)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.click()
  const panelContent = page.locator('[data-qa="agenda-appointment-panel"]')
  await expect(panelContent).toBeVisible({ timeout: 15_000 })

  // The appointment content and its action footer are siblings inside the
  // responsive dialog. Scope subsequent actions to the complete dialog so
  // footer buttons such as Editar/Confirmar remain reachable.
  const dialog = page.getByRole('dialog', { name: petName, exact: true })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

async function openEditModal(page, petName) {
  const panel = await openAppointmentPanel(page, petName)
  await panel.getByRole('button', { name: 'Editar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeVisible({ timeout: 15_000 })
}

async function reloadAgenda(page, petName) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settlePage(page)
  await expect(agendaCard(page, petName)).toBeVisible({ timeout: 30_000 })
}

test('Agenda hospedada persiste criacao, edicao, responsavel, concorrencia, drag e conclusao', async ({ page, context }, testInfo) => {
  const e2eEmail = String(process.env.E2E_EMAIL || '')
  test.skip(!process.env.YUISYNC_STAGING_URL || !e2eEmail.endsWith('@staging.invalid'), 'Esta regressao exige o tenant efemero do staging real.')
  test.skip(!process.env.E2E_PASSWORD, 'Credenciais E2E hospedadas nao configuradas.')
  test.setTimeout(6 * 60_000)

  await signIn(page, e2eEmail, process.env.E2E_PASSWORD)
  const fixture = await seedAgendaFixture(page, `${Date.now().toString(36)}-${testInfo.workerIndex}`)

  await page.goto('/petshop/agenda')
  await settlePage(page)

  await page.getByRole('button', { name: 'Agendar as 08:00' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()

  await page.getByRole('option', { name: new RegExp(fixture.tutorName, 'i') }).click()
  const serviceSearch = page.getByLabel('Buscar servico para adicionar')
  await serviceSearch.fill(fixture.serviceName)
  await page.getByRole('option', { name: new RegExp(fixture.serviceName, 'i') }).click()
  await page.getByLabel('Responsavel pelo atendimento').selectOption('esteticista-1')
  await page.getByLabel('Observacoes do agendamento').fill('agenda-hosted-initial')
  await page.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeHidden({ timeout: 30_000 })

  let card = agendaCard(page, fixture.petName)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card).toContainText('08:00')

  // Persistencia real apos reload.
  await reloadAgenda(page, fixture.petName)
  await openEditModal(page, fixture.petName)
  await expect(page.getByLabel('Responsavel pelo atendimento')).toHaveValue('esteticista-1')
  await expect(page.getByLabel('Observacoes do agendamento')).toHaveValue('agenda-hosted-initial')

  // Edicao + troca de responsavel devem sobreviver a uma nova leitura do Worker.
  await page.getByLabel('Responsavel pelo atendimento').selectOption('esteticista-2')
  await page.getByLabel('Observacoes do agendamento').fill('agenda-hosted-edited')
  await page.getByRole('button', { name: 'Salvar alteracoes' }).click()
  await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeHidden({ timeout: 30_000 })
  await reloadAgenda(page, fixture.petName)
  await openEditModal(page, fixture.petName)
  await expect(page.getByLabel('Responsavel pelo atendimento')).toHaveValue('esteticista-2')
  await expect(page.getByLabel('Observacoes do agendamento')).toHaveValue('agenda-hosted-edited')

  // Duas paginas compartilham a sessao mas fazem leituras independentes do backend.
  await reloadAgenda(page, fixture.petName)
  const observer = await context.newPage()
  await observer.goto('/petshop/agenda')
  await settlePage(observer)
  await expect(agendaCard(observer, fixture.petName)).toBeVisible({ timeout: 30_000 })

  await openEditModal(page, fixture.petName)
  await page.getByLabel('Observacoes do agendamento').fill('agenda-hosted-concurrent')
  await page.getByRole('button', { name: 'Salvar alteracoes' }).click()
  await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeHidden({ timeout: 30_000 })

  await reloadAgenda(observer, fixture.petName)
  await openEditModal(observer, fixture.petName)
  await expect(observer.getByLabel('Responsavel pelo atendimento')).toHaveValue('esteticista-2')
  await expect(observer.getByLabel('Observacoes do agendamento')).toHaveValue('agenda-hosted-concurrent')
  await observer.close()

  // Drag sem dependencia de cor/tema e com confirmacao da persistencia apos reload.
  await reloadAgenda(page, fixture.petName)
  // O comportamento de arraste e ligado depois que a grade resolvida sincroniza
  // seus identificadores. Esperar por esse estado evita iniciar o ponteiro no
  // pequeno intervalo em que o card ja esta visivel, mas ainda nao e movivel.
  card = movableAgendaCard(page, fixture.petName)
  await expect(card).toBeVisible({ timeout: 30_000 })
  const target = page.getByRole('button', { name: 'Agendar as 08:50' })
  await expect(target).toBeVisible({ timeout: 15_000 })
  await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }))

  await card.evaluate((element, targetLabel) => {
    const targetSlot = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.getAttribute('aria-label') === targetLabel)
    if (!targetSlot) throw new Error(`E2E_AGENDA_TARGET_NOT_FOUND:${targetLabel}`)

    const from = element.getBoundingClientRect()
    const to = targetSlot.getBoundingClientRect()
    const pointerId = 41
    const start = {
      clientX: from.left + Math.min(20, from.width / 3),
      clientY: from.top + Math.min(20, from.height / 3),
    }
    const end = {
      clientX: to.left + to.width / 2,
      clientY: to.top + Math.min(10, to.height / 2),
    }
    const pointer = (type, coordinates) => new PointerEvent(type, {
      ...coordinates,
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
    })

    element.dispatchEvent(pointer('pointerdown', start))
    document.dispatchEvent(pointer('pointermove', end))
    document.dispatchEvent(pointer('pointerup', end))
  }, 'Agendar as 08:50')

  await expect(page.getByText(/Agendamento movido para 08:50/i)).toBeVisible({ timeout: 30_000 })
  await expect(card).toContainText('08:50')
  await reloadAgenda(page, fixture.petName)
  await expect(agendaCard(page, fixture.petName)).toContainText('08:50')

  // Percorre a maquina de estados operacional ate a conclusao real.
  let panel = await openAppointmentPanel(page, fixture.petName)
  await panel.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible({ timeout: 30_000 })
  await panel.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Concluir', exact: true })).toBeVisible({ timeout: 30_000 })
  const dialogHandled = new Promise((resolve, reject) => {
    page.once('dialog', async (dialog) => {
      try {
        const message = dialog.message()
        await dialog.accept()
        resolve(message)
      } catch (error) {
        reject(error)
      }
    })
  })
  const [, confirmationMessage] = await Promise.all([
    panel.getByRole('button', { name: 'Concluir', exact: true }).click(),
    dialogHandled,
  ])
  expect(confirmationMessage).toMatch(/Concluir este atendimento/i)

  await expect(page.getByRole('heading', { name: 'Ficha / comprovante' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Fechar impressao' }).click()

  await reloadAgenda(page, fixture.petName)
  panel = await openAppointmentPanel(page, fixture.petName)
  await expect(panel.getByText(/Conclu[ií]do/i).first()).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByRole('button', { name: 'Confirmar', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Iniciar', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Concluir', exact: true })).toHaveCount(0)
})
