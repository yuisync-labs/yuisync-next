import { expect, test } from '@playwright/test'

test('arrasta um agendamento no modo diario sem depender da cor do tema', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'O gesto de arraste com mouse e validado no projeto desktop.')

  await page.goto('/login')
  await page.getByRole('button', { name: 'Explorar interface local' }).click()
  await page.goto('/petshop/agenda')

  await page.getByRole('button', { name: 'Agendar as 08:00' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeVisible()

  await page.getByRole('option', { name: /L.via Martins/i }).click()

  const serviceSearch = page.getByLabel('Buscar servico para adicionar')
  await serviceSearch.fill('Banho completo')
  await page.getByRole('option', { name: /Banho completo/i }).click()
  await expect(page.getByRole('button', { name: 'Remover Banho completo' })).toBeVisible()

  await page.getByRole('button', { name: 'Confirmar reserva' }).click()
  await expect(page.getByRole('heading', { name: 'Novo Agendamento' })).toBeHidden()

  const card = page.locator('[data-yuisync-appointment-id]').first()
  const target = page.getByRole('button', { name: 'Agendar as 08:50' })
  await expect(card).toBeVisible()
  await expect(target).toBeVisible()

  const from = await card.boundingBox()
  const to = await target.boundingBox()
  expect(from).toBeTruthy()
  expect(to).toBeTruthy()

  await page.mouse.move(from.x + Math.min(20, from.width / 3), from.y + Math.min(20, from.height / 3))
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(10, to.height / 2), { steps: 12 })
  await page.mouse.up()

  await expect(page.getByText(/Agendamento movido para 08:50/i)).toBeVisible()
  await expect(card).toContainText('08:50')
})
