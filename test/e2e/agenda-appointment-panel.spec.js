import { expect, test } from '@playwright/test'

async function createAppointment(page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explorar interface local' }).click()
  await page.goto('/petshop/agenda')

  await page.getByRole('button', { name: /^Agendar as 08:00/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()
  await page.getByRole('option', { name: /L.via Martins/i }).click()

  const serviceSearch = page.getByLabel('Buscar servico para adicionar')
  await serviceSearch.fill('Banho completo')
  await page.getByRole('option', { name: /Banho completo/i }).click()
  await page.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeHidden()
}

test('clique no atendimento abre edicao diretamente e preserva filtros ao fechar', async ({ page }) => {
  await createAppointment(page)
  const search = page.getByLabel('Buscar pet ou tutor')
  await search.fill('Martins')
  await page.locator('[data-yuisync-native-agenda-card="true"] .yuisync-card-content').first().click()
  await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeVisible()
  await expect(page.locator('[data-qa="agenda-appointment-panel"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Fechar agendamento' }).click()
  await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toHaveCount(0)
  await expect(search).toHaveValue('Martins')
})

test('no mobile o clique tambem abre o formulario de edicao diretamente', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createAppointment(page)
  await page.locator('[data-yuisync-native-agenda-card="true"] .yuisync-card-content').first().click()
  await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeVisible()
  await expect(page.locator('[data-qa="agenda-appointment-panel"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Fechar agendamento' }).click()
})
