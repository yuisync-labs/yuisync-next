import { expect, test } from '@playwright/test'
import {
  actionButton,
  appointmentById,
  assertNoInvalidCardGeometry,
  cardFor,
  confirmAndClick,
  createAppointment,
  createAppointmentFromCurrentAgenda,
  gotoAgenda,
  gotoTomorrowAgenda,
  historicalAppointmentRow,
  latestAppointmentForPet,
  localClock,
  moveCardTo,
  must,
  signIn,
} from './legacy-regression-browser-helpers.js'

let overlapIds = []

test.describe.serial('Agenda legacy incidents through real Chromium UI', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('AG-01 - criar e editar usa uma única identidade persistida', async ({ page }) => {
    const created = await createAppointment(page, { time: '08:10', notes: 'ag01 inicial' })
    const card = cardFor(page, created.id)
    await expect(card).toHaveCount(1)
    await card.locator('button.yuisync-card-content').click()
    await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toBeVisible()
    await page.getByLabel('Observacoes do agendamento').fill('AG01 EDITADO PELO NAVEGADOR')
    await page.getByRole('button', { name: 'Salvar alteracoes' }).click()
    await expect(page.getByRole('heading', { name: 'Editar Agendamento' })).toHaveCount(0, { timeout: 10_000 })
    await expect(cardFor(page, created.id)).toHaveCount(1)
    expect((await appointmentById(page, created.id)).notes).toBe('AG01 EDITADO PELO NAVEGADOR')
  })

  test('AG-02 - concluído e ativo do mesmo pet/horário não confundem ações', async ({ page }) => {
    const concluded = await createAppointment(page, { time: '08:20', notes: 'AG02 concluido' })
    await gotoAgenda(page)
    await createAppointmentFromCurrentAgenda(page, { time: '08:20', notes: 'AG02 ativo' })
    const active = await latestAppointmentForPet(page, must('E2E_PET_MEDIUM_ID'))
    await page.getByLabel('Próximo dia').click()

    await confirmAndClick(page, await actionButton(page, concluded.id, 'complete'))
    await expect.poll(async () => (await appointmentById(page, concluded.id)).status, { timeout: 10_000 }).toBe('concluido')

    await gotoTomorrowAgenda(page)
    await expect(historicalAppointmentRow(page, { time: '08:20', petName: 'Theo QA' })).toBeVisible({ timeout: 10_000 })
    const activeCard = cardFor(page, active.id)
    await expect(activeCard).toBeVisible()
    await expect(activeCard.locator('[data-yuisync-action="complete"]')).toBeVisible()
    await expect(activeCard.locator('[data-yuisync-action="cancel"]')).toBeVisible()
    expect((await appointmentById(page, concluded.id)).status).toBe('concluido')
    expect((await appointmentById(page, active.id)).status).not.toBe('concluido')
  })

  test('AG-03 - drag atualiza UI e D1 sem F5', async ({ page }) => {
    const created = await createAppointment(page, { time: '08:30', notes: 'AG03 drag' })
    await moveCardTo(page, created.id, '08:50')
    expect(localClock((await appointmentById(page, created.id)).scheduled_at)).toBe('08:50')
    await expect(cardFor(page, created.id)).toBeVisible()
  })

  test('AG-04 - mutações não apagam cards não relacionados', async ({ page }) => {
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
      window.__ag04Observer = new MutationObserver(() => {
        if (!document.querySelector(selector)) window.__ag04LostSentinel = true
      })
      window.__ag04Observer.observe(document.querySelector('.page') || document.body, { childList: true, subtree: true })
    }, sentinel.id)

    await moveCardTo(page, moving.id, '09:20')
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)
    await (await actionButton(page, moving.id, 'cancel')).click()
    await expect(cardFor(page, moving.id)).toHaveCount(0, { timeout: 10_000 })
    await expect(cardFor(page, sentinel.id)).toBeVisible()
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)

    await createAppointmentFromCurrentAgenda(page, {
      petName: 'Nina QA', petId: must('E2E_PET_SMALL_ID'), serviceName: 'Banho Pequeno QA',
      time: '15:00', notes: 'AG04 pacote zero',
    })
    const packageAppointment = await latestAppointmentForPet(page, must('E2E_PET_SMALL_ID'))
    await expect(cardFor(page, packageAppointment.id)).toBeVisible()
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)
    await confirmAndClick(page, await actionButton(page, packageAppointment.id, 'complete'))
    await expect.poll(async () => (await appointmentById(page, packageAppointment.id)).status, { timeout: 10_000 }).toBe('concluido')
    expect(await page.evaluate(() => window.__ag04LostSentinel)).toBe(false)
    await page.evaluate(() => window.__ag04Observer?.disconnect?.())
  })

  test('AG-05 - drag recalcula geometria com múltiplos cards', async ({ page }) => {
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
    await assertNoInvalidCardGeometry(page.locator(`[data-yuisync-native-appointment-id="${a.id}"], [data-yuisync-native-appointment-id="${b.id}"], [data-yuisync-native-appointment-id="${c.id}"]`))
  })

  test('AG-06 - 1, 2, 3, 4 e 5 simultâneos permanecem legíveis', async ({ page }) => {
    await gotoTomorrowAgenda(page)
    overlapIds = []
    for (let count = 1; count <= 5; count += 1) {
      const created = await createAppointmentFromCurrentAgenda(page, { time: '13:20', notes: `AG06 overlap ${count}` })
      overlapIds.push(created.id)
      const cards = page.locator('.yuisync-resolved-card').filter({ hasText: 'Theo QA' }).filter({ hasText: '13:20' })
      await expect(cards).toHaveCount(count, { timeout: 10_000 })
      await assertNoInvalidCardGeometry(cards)
      expect((await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.yuisyncDensity || ''))).every(Boolean)).toBe(true)
    }
  })

  test('AG-07 - todos os coincidentes continuam acessíveis e operáveis', async ({ page }) => {
    expect(overlapIds).toHaveLength(5)
    await gotoTomorrowAgenda(page)
    for (const id of overlapIds) {
      const card = cardFor(page, id)
      await expect(card).toBeVisible()
      await expect(card.locator('button.yuisync-card-content')).toBeVisible()
      await expect(card.locator('[data-yuisync-action="cancel"]')).toBeVisible()
      await expect(card.locator('[data-yuisync-action="print"]')).toBeVisible()
      await expect(card.locator('[data-yuisync-action="complete"]')).toBeVisible()
    }
  })

  test('AG-08 - ações permanecem 28x28 em 40/60/90/120 minutos', async ({ page }) => {
    await gotoTomorrowAgenda(page)
    const cases = [
      ['14:00', 40], ['14:50', 60], ['16:00', 90], ['17:40', 120],
    ]
    for (const [time, duration] of cases) {
      const appt = await createAppointmentFromCurrentAgenda(page, { time, duration, notes: `AG08 ${duration}` })
      const buttons = cardFor(page, appt.id).locator('[data-yuisync-action]')
      await expect(buttons).toHaveCount(3)
      const sizes = await buttons.evaluateAll((nodes) => nodes.map((node) => {
        const box = node.getBoundingClientRect()
        return [Math.round(box.width), Math.round(box.height)]
      }))
      expect(sizes).toEqual([[28, 28], [28, 28], [28, 28]])
    }
  })

  test('AG-09 - ordem é cancelar → imprimir → concluir', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(1)
    await gotoTomorrowAgenda(page)
    const actions = cardFor(page, overlapIds[0]).locator('[data-yuisync-resolved-actions] [data-yuisync-action]')
    await expect(actions).toHaveCount(3)
    expect(await actions.evaluateAll((nodes) => nodes.map((node) => node.dataset.yuisyncAction))).toEqual(['cancel', 'print', 'complete'])
  })

  test('AG-10 - cancelar preserva registro com status cancelado', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(1)
    const id = overlapIds[0]
    await gotoTomorrowAgenda(page)
    await (await actionButton(page, id, 'cancel')).click()
    await expect(cardFor(page, id)).toHaveCount(0, { timeout: 10_000 })
    const persisted = await appointmentById(page, id)
    expect(persisted.id).toBe(id)
    expect(persisted.status).toBe('cancelado')
  })

  test('AG-11 - concluído não pode ser arrastado ou concluído de novo', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(2)
    const id = overlapIds[1]
    await gotoTomorrowAgenda(page)
    await confirmAndClick(page, await actionButton(page, id, 'complete'))
    await expect.poll(async () => (await appointmentById(page, id)).status, { timeout: 10_000 }).toBe('concluido')
    await gotoTomorrowAgenda(page)
    await expect(historicalAppointmentRow(page, { time: '13:20', petName: 'Theo QA' })).toBeVisible()
    await expect(cardFor(page, id)).toHaveCount(0)
    expect((await appointmentById(page, id)).status).toBe('concluido')
  })

  test('AG-12 - recusar confirmação impede conclusão', async ({ page }) => {
    expect(overlapIds.length).toBeGreaterThanOrEqual(3)
    const id = overlapIds[2]
    await gotoTomorrowAgenda(page)
    const before = await appointmentById(page, id)
    let dialogSeen = false
    page.once('dialog', async (dialog) => {
      dialogSeen = true
      await dialog.dismiss()
    })
    await (await actionButton(page, id, 'complete')).click()
    await expect.poll(() => dialogSeen, { timeout: 3_000 }).toBe(true)
    await page.waitForTimeout(250)
    expect((await appointmentById(page, id)).status).toBe(before.status)
  })
})
