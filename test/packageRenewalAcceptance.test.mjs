import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('REN-01 concluído exige todos os limites usados e nenhuma reserva', async () => {
  const source = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  assert.match(source, /subscription\.status !== 'active'/)
  assert.match(source, /item\.used >= item\.total/)
  assert.match(source, /item\.reserved === 0/)
})

test('REN-02 e REN-04 preservam o ciclo concluído e criam uma nova assinatura', async () => {
  const source = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  assert.match(source, /effectiveSubscriptionStatus\(subscription\)/)
  assert.match(source, /setSubscriptionModal\(\{[\s\S]*renewalOf: subscription/)
  assert.doesNotMatch(source, /renewSubscription[\s\S]{0,900}delete\(/)
  assert.match(source, /preserva o ciclo anterior no histórico/i)
})

test('REN-03 ciclo concluído deixa de contar como assinatura ativa', async () => {
  const source = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  assert.match(source, /subscription\.status === 'active' && !subscriptionIsCompleted\(subscription\)/)
  assert.match(source, /Assinaturas ativas/)
  assert.match(source, /activeSubscriptions\.length/)
})

test('REN-05 reutiliza renovação pending_payment em vez de abrir outra', async () => {
  const ui = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  const edge = await read('apps/edge-api/src/packageCycleApi.ts')
  assert.match(ui, /candidate\.status === 'pending_payment'/)
  assert.match(ui, /focusSubscriptionPayment\(pendingRenewal\.id\)/)
  assert.match(edge, /PACKAGE_RENEWAL_ALREADY_PENDING/)
})

test('REN-06 exige agenda nova antes do pagamento', async () => {
  const modal = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  const checkout = await read('src/modules/petshop/pages/PackageActivationReliablePanel.jsx')
  const edge = await read('apps/edge-api/src/packageCycleApi.ts')
  assert.match(modal, /renovação só será enviada para pagamento depois que a primeira data e o horário do novo ciclo forem informados/i)
  assert.match(checkout, /schedule\.length === 4/)
  assert.match(checkout, /disabled=\{saving \|\| !scheduleReady\}/)
  assert.match(edge, /PACKAGE_SCHEDULE_REQUIRED/)
})

test('REN-07 fixa pet e pacote do ciclo anterior na renovação', async () => {
  const source = await read('src/modules/petshop/pages/PlanosNativePage.jsx')
  assert.match(source, /fixedPlanId = pendingSubscription\?\.plan_id \|\| renewalOf\?\.plan_id/)
  assert.match(source, /fixedClientId = pendingSubscription\?\.client_id \|\| renewalOf\?\.client_id/)
  assert.match(source, /<select className="inp" disabled=\{renewal\}/)
  assert.match(source, /Pet que receberá a renovação/)
})
