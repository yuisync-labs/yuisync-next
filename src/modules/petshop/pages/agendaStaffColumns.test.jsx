import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgendaTimelineView, ApptModal } from './AgendaPage'
import { agendaStaffColumns } from './agendaStaffColumns'

afterEach(cleanup)
const staff = [{ key: 'ana', name: 'Ana', active: true }, { key: 'bia', name: 'Bia', active: true }]
const day = new Date(2026, 9, 13, 12)
const appointment = (id, key) => ({
  id, responsible_staff_key: key, scheduled_at: new Date(2026, 9, 13, 9).toISOString(),
  duration_min: 60, status: 'agendado', pets: { pet_name: id },
})

it('cria colunas apenas para as profissionais ativas', () => {
  expect(agendaStaffColumns([...staff, { key: 'old', name: 'Clara', active: false }], [
    appointment('p1', 'old'), appointment('p2', ''), { ...appointment('p3', 'missing'), responsible_staff_name: 'Dora' },
  ]).map((item) => item.name)).toEqual(['Ana', 'Bia'])
  expect(agendaStaffColumns([], [])).toEqual([])
})

it('separa atendimentos simultâneos e envia data, horário e esteticista do clique', () => {
  const onCreateAt = vi.fn()
  const { container } = render(<AgendaTimelineView
    days={[day]} selectedDate={day} appointments={[appointment('Rex', 'ana'), appointment('Luna', 'bia')]}
    serviceLabel={() => 'Banho'} statusBadge={() => ({ label: 'Agendado', cls: '' })}
    staffById={new Map(staff.map((person) => [person.key, person]))}
    divideByStaff onCreateAt={onCreateAt}
  />)
  expect(container.querySelector('[data-agenda-staff-column="ana"]')).toHaveTextContent('Rex')
  expect(container.querySelector('[data-agenda-staff-column="ana"]')).not.toHaveTextContent('Luna')
  expect(container.querySelector('[data-agenda-staff-column="bia"]')).toHaveTextContent('Luna')
  fireEvent.click(screen.getByRole('button', { name: 'Agendar as 08:00 com Bia', exact: true }))
  expect(onCreateAt).toHaveBeenCalledWith(day, '08:00', 'bia')
})

it('abre nova reserva com a esteticista selecionada e permite alterá-la', () => {
  render(<ApptModal appt={{ date: '2026-10-13', time: '08:00', responsible_staff_key: 'bia' }} pets={[]} staff={staff}/>)
  const select = screen.getByLabelText('Responsavel pelo atendimento')
  expect(select).toHaveValue('bia')
  fireEvent.change(select, { target: { value: 'ana' } })
  expect(select).toHaveValue('ana')
})

it('mantém agenda única quando a divisão está desabilitada', () => {
  render(<AgendaTimelineView days={[day]} selectedDate={day} appointments={[]} staffById={new Map()}
    serviceLabel={() => ''} statusBadge={() => ({})} onCreateAt={vi.fn()}/>)
  expect(screen.getByRole('button', { name: 'Agendar as 08:00', exact: true })).toBeInTheDocument()
})

it('exibe concluído sem responsável no histórico sem criar uma terceira coluna', () => {
  const onEdit = vi.fn()
  const historical = { ...appointment('Historico', null), status: 'concluido' }
  const { container } = render(<AgendaTimelineView days={[day]} selectedDate={day}
    appointments={[historical]} staffById={new Map(staff.map((person) => [person.key, person]))}
    divideByStaff serviceLabel={() => 'Banho'} statusBadge={() => ({ label: 'Concluído', cls: '' })}
    onCreateAt={vi.fn()} onEdit={onEdit}/>)
  expect(container.querySelectorAll('[data-agenda-staff-column]')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /Historico.*Concluído/ }))
  expect(onEdit).toHaveBeenCalledWith(historical)
  expect(historical.responsible_staff_key).toBeNull()
})


it('mostra tres colunas com Neto ativo e duas ao desativa-lo sem perder atendimentos', () => {
  const people = [...staff, { key:'neto',name:'Neto',active:true }]
  const appointments = [appointment('Pet do Neto','neto'),appointment('Sem profissional','')]
  const props = { days:[day],selectedDate:day,appointments,divideByStaff:true,
    serviceLabel:()=> 'Banho',statusBadge:()=>({ label:'Agendado',cls:'' }),onCreateAt:vi.fn(),onEdit:vi.fn() }
  const {container,rerender}=render(<AgendaTimelineView {...props} staffById={new Map(people.map(p=>[p.key,p]))}/> )
  expect(container.querySelectorAll('[data-agenda-staff-column]')).toHaveLength(3)
  expect(container.querySelector('[data-agenda-staff-column="neto"]')).toHaveTextContent('Pet do Neto')
  expect(container.querySelector('[data-agenda-pending-assignments]')).toHaveTextContent('Sem profissional')
  expect(container.querySelector('[data-agenda-staff-column="neto"]')).not.toHaveTextContent('Sem profissional')
  rerender(<AgendaTimelineView {...props} staffById={new Map(people.map(p=>[p.key,p.key==='neto'?{...p,active:false}:p]))}/> )
  expect(container.querySelectorAll('[data-agenda-staff-column]')).toHaveLength(2)
  expect(container.querySelector('[data-agenda-pending-assignments]')).toHaveTextContent('Pet do Neto')
  expect(appointments[0].responsible_staff_key).toBe('neto')
  expect(appointments[1].responsible_staff_key).toBe('')
})

it('orienta a ativar uma profissional quando todas estao inativas', () => {
  const {container}=render(<AgendaTimelineView days={[day]} selectedDate={day} appointments={[]}
    staffById={new Map(staff.map(p=>[p.key,{...p,active:false}]))} divideByStaff
    serviceLabel={()=>''} statusBadge={()=>({})} onCreateAt={vi.fn()}/> )
  expect(container.querySelectorAll('[data-agenda-staff-column]')).toHaveLength(0)
  expect(screen.getByText(/Ative uma esteticista nos marcadores da agenda/)).toBeInTheDocument()
})
