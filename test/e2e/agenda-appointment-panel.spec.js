import { expect, test } from '@playwright/test'

async function createAppointment(page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explorar interface local' }).click()
  await page.goto('/petshop/agenda')

  await page.getByRole('button', { name: 'Agendar as 08:00' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()
  await page.getByRole('option', { name: /L.via Martins/i }).click()

  const serviceSearch = page.getByLabel('Buscar servico para adicionar')
  await serviceSearch.fill('Banho completo')
  await page.getByRole('option', { name: /Banho completo/i }).click()
  await page.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeHidden()
}

test('abre o painel do atendimento sem perder filtros e fecha por Escape', async ({ page }) => {
  await createAppointment(page)

  const search = page.getByLabel('Buscar pet ou tutor')
  await search.fill('Livia')

  const cardContent = page.locator('[data-yuisync-native-agenda-card="true"] .yuisync-card-content').first()
  await expect(cardContent).toBeVisible()
  await cardContent.click()

  const panel = page.locator('[data-qa="agenda-appointment-panel"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Atendimento', { exact: true })).toBeVisible()
  await expect(panel.getByText('Serviços', { exact: true })).toBeVisible()
  await expect(panel.getByText('Responsável', { exact: true })).toBeVisible()
  await expect(panel.getByText('Pacote', { exact: true })).toBeVisible()
  await expect(panel.getByText('Pagamento', { exact: true })).toBeVisible()
  await expect(panel.getByText('Histórico do cliente', { exact: true })).toBeVisible()

  const close = page.getByRole('button', { name: 'Fechar painel' })
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(search).toHaveValue('Livia')
})

test('no desktop a agenda continua renderizada enquanto o painel esta aberto', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'A validacao lado a lado e especifica do desktop.')
  await createAppointment(page)

  await page.locator('[data-yuisync-native-agenda-card="true"] .yuisync-card-content').first().click()
  await expect(page.locator('[data-qa="agenda-appointment-panel"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Agendar as 08:50' })).toBeVisible()
})
