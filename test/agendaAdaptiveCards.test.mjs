import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { agendaVisualLaneCount, layoutAgendaOverlapClusters } from '../src/modules/petshop/lib/appointmentOperational.js'

const at = (time) => new Date(`2026-07-30T${time}:00-03:00`)
const bounds = (item) => ({ start: at(item.start), end: at(item.end) })

test('um card ocupa toda a coluna e simultaneos dividem o espaco', () => {
  assert.equal(agendaVisualLaneCount(0), 1)
  assert.equal(agendaVisualLaneCount(1), 1)
  assert.equal(agendaVisualLaneCount(2), 2)
  assert.equal(agendaVisualLaneCount(3), 3)
  assert.equal(agendaVisualLaneCount(5), 5)
})

test('novo grupo de horario volta para a primeira coluna', () => {
  const items = [
    { id: 'a', start: '08:10', end: '09:40', created_at: '2026-07-30T10:00:00Z' },
    { id: 'b', start: '08:10', end: '09:10', created_at: '2026-07-30T10:01:00Z' },
    { id: 'c', start: '08:10', end: '08:50', created_at: '2026-07-30T10:02:00Z' },
    { id: 'd', start: '09:40', end: '10:20', created_at: '2026-07-30T10:03:00Z' },
  ]
  const layout = layoutAgendaOverlapClusters(items, bounds)
  const byId = new Map(layout.map((entry) => [entry.item.id, entry]))
  assert.deepEqual(layout.map((entry) => entry.item.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual([byId.get('a').lane, byId.get('b').lane, byId.get('c').lane], [0, 1, 2])
  assert.equal(byId.get('a').laneCount, 3)
  assert.equal(byId.get('d').lane, 0)
  assert.equal(byId.get('d').laneCount, 1)
})

test('card nasce verde e sincroniza pelo id sem depender de ctrl f5', async () => {
  const [agenda, css, resolved, integrated] = await Promise.all([
    readFile(new URL('../src/modules/petshop/pages/AgendaPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaIntegratedPage.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(agenda, /data-yuisync-native-agenda-card="true"/)
  assert.match(agenda, /data-yuisync-native-appointment-id/)
  assert.match(css, /\.yuisync-agenda-card-surface[\s\S]*background: linear-gradient/)
  assert.match(resolved, /scheduleOperationalReload/)
  assert.match(resolved, /data-yuisync-native-appointment-id/)
  assert.match(integrated, /querySelectorAll\('\.yuisync-agenda-card-surface'\)/)
})

test('cards estreitos reservam botoes apenas no cabecalho e preservam linhas uteis', async () => {
  const [agenda, css, integrated] = await Promise.all([
    readFile(new URL('../src/modules/petshop/pages/AgendaPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaIntegratedPage.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(agenda, /yuisync-card-header/)
  assert.match(agenda, /yuisync-card-service/)
  assert.match(agenda, /yuisync-card-responsible/)
  assert.doesNotMatch(css, /padding-right: 132px/)
  assert.match(css, /\.yuisync-card-header[\s\S]*padding-right: 96px/)
  assert.doesNotMatch(integrated, /> button\.w-full\.text-left > \.mt-2[\s\S]*display: none/)
  assert.match(integrated, /min-width: 0 !important/)
})

test('botoes operacionais mantem tamanho intermediario em qualquer densidade', async () => {
  const css = await readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.css', import.meta.url), 'utf8')
  assert.match(css, /\.yuisync-resolved-action \{[\s\S]*width: 28px;[\s\S]*height: 28px;[\s\S]*flex: 0 0 28px;/)
  assert.match(css, /\.yuisync-agenda-card-surface\[data-yuisync-density\] \.yuisync-resolved-action[\s\S]*width: 28px !important;[\s\S]*height: 28px !important;/)
  assert.match(css, /\.yuisync-agenda-card-surface\[data-yuisync-density\] \.yuisync-card-header[\s\S]*padding-right: 96px !important;/)
  assert.doesNotMatch(css, /width: 36px|width: 32px/)
})

test('arraste confirma no banco e deixa o jsx nativo recalcular top coluna e largura', async () => {
  const [resolved, integrated] = await Promise.all([
    readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaIntegratedPage.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(resolved, /chooseAgendaSlot\(slots\(\), event.clientX, event.clientY\)/)
  assert.match(resolved, /void moveAppointment\(id, time, slot\?\.dataset\.responsibleStaffKey, slot\?\.dataset\.responsibleStaffName\)/)
  assert.match(resolved, /await update\(appointmentId, \{\s*scheduled_at: target.toISOString\(\),[\s\S]*setNotice/)
  assert.match(resolved, /is-yuisync-pointer-dragging/)
  assert.doesNotMatch(resolved, /refreshAgendaPage/)
  assert.doesNotMatch(integrated, /shiftedInterval|pendingMove|suppressRefreshUntil/)
  assert.doesNotMatch(integrated, /outer\.style\.top|intervalNode\.textContent/)
  assert.doesNotMatch(integrated, /button\[title="Atualizar"\][\s\S]*preventDefault/)
})

test('acoes ficam cancelar imprimir concluir e sincronizam sem recarregar a tabela', async () => {
  const [resolved, css, hook] = await Promise.all([
    readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaResolvedPage.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/hooks/useAppointments.js', import.meta.url), 'utf8'),
  ])
  const cancelIndex = resolved.indexOf('data-yuisync-action="cancel"')
  const printIndex = resolved.indexOf('data-yuisync-action="print"')
  const completeIndex = resolved.indexOf('data-yuisync-action="complete"')
  assert.ok(cancelIndex >= 0 && cancelIndex < printIndex && printIndex < completeIndex)
  assert.ok(resolved.includes('actions.innerHTML = actionMarkup(movable, canComplete)'))
  assert.doesNotMatch(resolved, /data-yuisync-action="drag"/)
  assert.ok(resolved.includes("updateStatus(appointmentId, 'cancelado')"))
  assert.ok(resolved.includes('if (action) return'))
  assert.equal(resolved.includes('button[title="Atualizar"]'), false)
  assert.ok(css.includes('.yuisync-resolved-action.is-cancel'))
  assert.ok(hook.includes('APPOINTMENT_SYNC_EVENT'))
  assert.ok(hook.includes("emitAppointmentSync({ type: 'upsert'"))
})

test('cards aproveitam faixas livres sem invadir outros horarios sobrepostos', () => {
  const items = [
    { id: 'long', start: '08:00', end: '10:00' },
    { id: 'short-a', start: '08:00', end: '08:30' },
    { id: 'short-b', start: '08:00', end: '08:30' },
    { id: 'later', start: '08:30', end: '09:00' },
    { id: 'alone', start: '10:00', end: '11:00' },
  ]
  const layout = layoutAgendaOverlapClusters(items, bounds)
  const later = layout.find(row => row.item.id === 'later')
  const alone = layout.find(row => row.item.id === 'alone')
  assert.deepEqual([later.lane,later.laneSpan,later.laneCount], [1,2,3])
  assert.deepEqual([alone.lane,alone.laneSpan,alone.laneCount], [0,1,1])
  for (const a of layout) for (const b of layout) {
    if (a === b) continue
    const ta = bounds(a.item), tb = bounds(b.item)
    if (ta.start < tb.end && tb.start < ta.end) {
      const leftA = a.lane / a.laneCount, rightA = (a.lane + a.laneSpan) / a.laneCount
      const leftB = b.lane / b.laneCount, rightB = (b.lane + b.laneSpan) / b.laneCount
      assert.ok(rightA <= leftB || rightB <= leftA)
    }
  }
})
