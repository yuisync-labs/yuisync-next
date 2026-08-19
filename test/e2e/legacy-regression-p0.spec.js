import { test, expect } from '@playwright/test'

const runTag = `legacy-${Date.now().toString(36)}`
const tutorName = `Tutor QA ${runTag}`
const firstPetName = `Luna QA ${runTag}`
const secondPetName = `Thor QA ${runTag}`
const productName = `Racao QA ${runTag}`
const serviceName = `Banho QA ${runTag}`
const packageName = `Pacote QA ${runTag}`
const appointmentNote = `observacao-regressao-${runTag}`
const editedNote = `observacao-editada-${runTag}`
const phone = `(32) 99999-${String(Date.now()).slice(-4)}`
const scheduledDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function modalByTitle(page, title) {
  return page.locator('.modal-box').filter({ has: page.getByRole('heading', { name: title }) }).last()
}

function controlForLabel(scope, text) {
  const label = scope.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}(?:\\s*\\*)?\\s*$`, 'i') }).first()
  return label.locator('..').locator('input, select, textarea').first()
}

async function signIn(page) {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  if (!email || !password) throw new Error('E2E_EMAIL and E2E_PASSWORD are required')

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('form button[type="submit"]').click({ timeout: 15_000 })
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 })
}

async function openRoute(page, route) {
  const runtimeErrors = []
  const onPageError = (error) => runtimeErrors.push(`pageerror:${error.message}`)
  const onResponse = (response) => {
    if (response.status() >= 500) runtimeErrors.push(`http-${response.status()}:${response.url()}`)
  }
  page.on('pageerror', onPageError)
  page.on('response', onResponse)

  await page.goto(route, { waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
  await page.waitForTimeout(500)

  page.off('pageerror', onPageError)
  page.off('response', onResponse)
  expect(runtimeErrors, `runtime errors on ${route}`).toEqual([])
}

async function createPhysicalProduct(page) {
  await openRoute(page, '/petshop/estoque')
  await page.getByRole('button', { name: /Novo Produto$/ }).click()
  const modal = modalByTitle(page, 'Novo Produto')
  await expect(modal).toBeVisible()
  await controlForLabel(modal, 'Nome do Produto').fill(productName)
  await controlForLabel(modal, 'Preço de Venda (R$)').fill('19.90')
  await controlForLabel(modal, 'Estoque Atual (UN)').fill('12')
  await controlForLabel(modal, 'Estoque Mínimo (UN)').fill('2')
  await modal.getByRole('button', { name: 'Criar Produto' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
}

async function createAgendaService(page) {
  await openRoute(page, '/petshop/estoque')
  await page.getByRole('button', { name: /Serviços \(/ }).click()
  await page.getByRole('button', { name: /Novo Serviço$/ }).click()
  const modal = modalByTitle(page, 'Novo Serviço')
  await expect(modal).toBeVisible()
  await controlForLabel(modal, 'Nome do Serviço').fill(serviceName)
  await controlForLabel(modal, 'Preço de Venda (R$)').fill('55')
  await controlForLabel(modal, 'Area do servico').selectOption('banho_tosa')
  await modal.getByRole('button', { name: 'Criar Serviço' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText(serviceName, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
}

async function createTutorAndTwoPets(page) {
  await openRoute(page, '/petshop/pets')
  await page.getByRole('button', { name: 'Novo cadastro' }).click()
  let modal = modalByTitle(page, 'Novo cliente e pet')
  await expect(modal).toBeVisible()
  await controlForLabel(modal, 'Tutor').fill(tutorName)
  await controlForLabel(modal, 'Telefone').fill(phone)
  await controlForLabel(modal, 'Email').fill(`${runTag}@example.invalid`)
  await controlForLabel(modal, 'Endereco').fill('Av. QA Automacao')
  await controlForLabel(modal, 'Numero').fill('191')
  await controlForLabel(modal, 'Bairro').fill('Centro')
  await controlForLabel(modal, 'Cidade').fill('Muriae')
  await controlForLabel(modal, 'Referencia').fill('Portao azul QA')
  await controlForLabel(modal, 'Pet').fill(firstPetName)
  await controlForLabel(modal, 'Especie').selectOption('dog')
  await controlForLabel(modal, 'Raca').fill('Shih Tzu')
  await controlForLabel(modal, 'Peso').fill('10.1')
  await modal.getByRole('button', { name: 'Salvar cadastro' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })

  const tutorCard = page.locator('div').filter({ hasText: tutorName }).filter({ has: page.getByRole('button', { name: 'Adicionar pet' }) }).last()
  await expect(tutorCard).toBeVisible({ timeout: 15_000 })
  await tutorCard.getByRole('button', { name: 'Adicionar pet' }).click()
  modal = modalByTitle(page, 'Adicionar pet ao cliente')
  await expect(modal).toBeVisible()
  await controlForLabel(modal, 'Pet').fill(secondPetName)
  await controlForLabel(modal, 'Especie').selectOption('dog')
  await controlForLabel(modal, 'Raca').fill('SRD')
  await controlForLabel(modal, 'Peso').fill('22.1')
  await modal.getByRole('button', { name: 'Salvar novo pet' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })

  await expect(page.getByText('2 pets cadastrados', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(firstPetName, { exact: true })).toBeVisible()
  await expect(page.getByText(secondPetName, { exact: true })).toBeVisible()
}

async function createAndStartPackageSale(page) {
  await openRoute(page, '/petshop/planos')
  await page.getByRole('button', { name: 'Novo pacote' }).click()
  let modal = modalByTitle(page, 'Novo pacote')
  await expect(modal).toBeVisible()
  await controlForLabel(modal, 'Nome de identificação').fill(packageName)
  await controlForLabel(modal, 'Preço do pacote').fill('149.90')
  await controlForLabel(modal, 'Serviço real').selectOption({ label: new RegExp(escapeRegExp(serviceName)) })
  await controlForLabel(modal, 'Por ciclo').fill('2')
  await modal.getByRole('button', { name: /Salvar pacote/ }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText(packageName, { exact: true }).first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Vender pacote' }).click()
  modal = modalByTitle(page, 'Vender pacote ao cliente')
  await expect(modal).toBeVisible()
  await controlForLabel(modal, 'Pacote').selectOption({ label: new RegExp(escapeRegExp(packageName)) })
  await modal.getByRole('button', { name: 'Pesquisar tutor ou pet' }).click()
  await modal.getByPlaceholder('Digite tutor, pet ou telefone...').fill(tutorName)
  await modal.getByRole('button', { name: new RegExp(escapeRegExp(tutorName)) }).first().click()
  await expect(modal.getByText('Escolha qual pet receberá o pacote')).toBeVisible()
  await modal.getByRole('button', { name: new RegExp(`^${escapeRegExp(firstPetName)}`) }).click()
  await modal.getByRole('button', { name: 'Continuar para pagamento' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/petshop\/ordens/, { timeout: 15_000 })
}

async function createMotodogAppointmentAndEditNote(page) {
  await openRoute(page, '/petshop/agenda')
  await page.getByRole('button', { name: 'Novo Agendamento' }).first().click()
  let modal = modalByTitle(page, 'Novo Agendamento')
  await expect(modal).toBeVisible()

  await modal.getByRole('button', { name: /Buscar cliente ou pet/ }).click()
  await modal.getByLabel('Buscar cliente ou pet').fill(tutorName)
  await modal.getByRole('button', { name: new RegExp(escapeRegExp(tutorName)) }).first().click()
  await expect(modal.getByText('Escolha o pet para este agendamento')).toBeVisible()
  await modal.getByRole('button', { name: new RegExp(`^${escapeRegExp(secondPetName)}`) }).click()

  const serviceSearch = modal.getByLabel('Buscar servico para adicionar')
  await serviceSearch.fill(serviceName)
  await modal.getByRole('button', { name: new RegExp(escapeRegExp(serviceName)) }).last().click()

  await modal.getByLabel('Data do agendamento').fill(scheduledDate)
  await modal.getByLabel('Horario do agendamento').fill('14:20')
  await modal.getByLabel('Transporte do pet').selectOption('buscar_e_levar')
  await expect(modal).toContainText('Av. QA Automacao')
  await modal.getByLabel('Observacoes do agendamento').fill(appointmentNote)
  await modal.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })

  await expect(page.getByText(secondPetName, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/MotoDog - buscar e levar/).first()).toBeVisible()

  await page.getByRole('button', { name: 'Editar agendamento' }).first().click()
  modal = modalByTitle(page, 'Editar Agendamento')
  await expect(modal).toBeVisible()
  await modal.getByLabel('Observacoes do agendamento').fill(editedNote)
  await modal.getByRole('button', { name: 'Salvar alteracoes' }).click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText(editedNote, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
}

async function checkoutPhysicalProduct(page) {
  await openRoute(page, '/petshop/vendas')
  await page.getByRole('button', { name: 'Modo Caixa' }).click()
  const scanner = page.getByLabel('Buscar produto ou ler codigo de barras')
  await scanner.fill(productName)
  await page.getByRole('button', { name: new RegExp(escapeRegExp(productName)) }).first().click()
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible()
  const finalize = page.getByRole('button', { name: /Finalizar venda/ })
  await expect(finalize).toBeEnabled({ timeout: 10_000 })
  await finalize.click()
  await expect(page.getByText(/Venda conclu|Venda realizada|sucesso/i).first()).toBeVisible({ timeout: 15_000 })
}

test.describe.serial('legacy P0 regression browser matrix', () => {
  test('01 - admin can traverse every historical module route without 5xx/page errors', async ({ page }) => {
    await signIn(page)
    const routes = [
      '/petshop/dashboard', '/petshop/agenda', '/petshop/vendas', '/petshop/ordens', '/petshop/chat',
      '/petshop/growth', '/petshop/pets', '/petshop/fidelidade', '/petshop/caixa', '/petshop/relatorios',
      '/petshop/planos', '/petshop/financeiro', '/petshop/estoque', '/petshop/campanhas', '/petshop/usuarios',
      '/petshop/equipe', '/petshop/config', '/petshop/logs',
    ]
    for (const route of routes) await openRoute(page, route)
  })

  test('02 - catalog creates physical product and agenda service', async ({ page }) => {
    await signIn(page)
    await createPhysicalProduct(page)
    await createAgendaService(page)
  })

  test('03 - client registration keeps one tutor with multiple pets and distinct weights', async ({ page }) => {
    await signIn(page)
    await createTutorAndTwoPets(page)
  })

  test('04 - package uses a real catalog service and selects the intended pet in a multi-pet tutor', async ({ page }) => {
    await signIn(page)
    await createAndStartPackageSale(page)
  })

  test('05 - agenda selects the intended pet, preserves MotoDog address and note-only edit', async ({ page }) => {
    await signIn(page)
    await createMotodogAppointmentAndEditNote(page)
  })

  test('06 - POS adds stocked product and completes transactional checkout through UI', async ({ page }) => {
    await signIn(page)
    await checkoutPhysicalProduct(page)
  })
})
