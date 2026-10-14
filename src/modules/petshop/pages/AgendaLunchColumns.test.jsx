import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgendaTimelineView } from './AgendaPage'
import { AgendaFluidRefinement } from './AgendaIntegratedPage'

const day = new Date(2026, 9, 14, 12)
const staff = [{ key: 'ana', name: 'Ana' }, { key: 'bia', name: 'Bia' }]
const appointment = (id, key, hour = 13) => ({ id, responsible_staff_key: key,
  scheduled_at: new Date(2026, 9, 14, hour).toISOString(), duration_min: 60,
  status: 'agendado', pets: { pet_name: id } })
const renderAgenda = (appointments) => render(<>
  <AgendaTimelineView days={[day]} selectedDate={day} appointments={appointments}
    staffById={new Map(staff.map(person => [person.key, person]))} divideByStaff
    serviceLabel={() => 'Banho'} statusBadge={() => ({ label: 'Agendado', cls: '' })}
    onCreateAt={vi.fn()} onEdit={vi.fn()}/>
  <AgendaFluidRefinement/>
</>)
const flush = () => act(() => vi.advanceTimersByTime(20))
const cardPosition = (container, id) => container.querySelector(`[data-yuisync-native-appointment-id="${id}"]`).parentElement.style.top

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })

it('keeps both staff cards and slots aligned when collapsing and reopening lunch', () => {
  const { container } = renderAgenda([appointment('Bill', 'ana'), appointment('Toddy', 'bia')])
  flush()
  const grid = container.querySelector('.yuisync-agenda-daily-grid')
  expect(grid.dataset.yuisyncLunchCollapsed).toBe('true')
  const columns = [...grid.querySelectorAll('[data-agenda-staff-column]')]
  expect(cardPosition(container, 'Bill')).toBe(cardPosition(container, 'Toddy'))
  const tops = ['Ana', 'Bia'].map(name => screen.getByRole('button', { name: `Agendar as 13:00 com ${name}` }).style.top)
  expect(tops[0]).toBe(tops[1])
  expect(columns[0].style.height).toBe(columns[1].style.height)
  expect(columns[0].style.height).toBe(grid.querySelector('[data-agenda-time-column]').style.height)
  expect(grid.querySelectorAll('[data-yuisync-lunch-marker="content"]')).toHaveLength(2)
  fireEvent.click(columns[1].querySelector('[data-yuisync-lunch-marker="content"]'))
  flush()
  expect(grid.dataset.yuisyncLunchCollapsed).toBe('false')
  expect(cardPosition(container, 'Bill')).toBe('722px')
  expect(cardPosition(container, 'Toddy')).toBe('722px')
  expect(grid.querySelectorAll('[data-yuisync-lunch-marker]')).toHaveLength(0)
  fireEvent.click(screen.getByText('Recolher 11:00–13:00'))
  flush()
  expect(cardPosition(container, 'Bill')).toBe(cardPosition(container, 'Toddy'))
})

it('does not collapse lunch when only the second staff column is occupied', () => {
  const { container } = renderAgenda([appointment('Bill', 'ana'), appointment('Lunch', 'bia', 12)])
  flush()
  expect(container.querySelector('.yuisync-agenda-daily-grid').dataset.yuisyncLunchCollapsed).toBe('false')
  expect(screen.getByText('11:00–13:00 em uso')).toBeDisabled()
  expect(cardPosition(container, 'Bill')).toBe('722px')
  expect(cardPosition(container, 'Lunch')).toBe('578px')
  expect(container.querySelectorAll('[data-yuisync-lunch-marker]')).toHaveLength(0)
})
