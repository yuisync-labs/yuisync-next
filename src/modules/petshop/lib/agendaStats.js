import { appointmentServiceLabel, normalizeAppointmentServiceText } from './appointmentServices'
import { isoDate, localDateKey } from '../pages/agendaOperationalCore'

// Use the same in-memory rows and local dates as the agenda cards. Package
// coverage changes billing, not whether an appointment is a bath or grooming.
export function buildAgendaStats(appointments, selectedDate, services = []) {
  const day = isoDate(selectedDate)
  const stats = { total: 0, agendado: 0, confirmado: 0, em_andamento: 0, concluido: 0, cancelado: 0, baths: 0, grooming: 0 }
  const statuses = { scheduled: 'agendado', confirmed: 'confirmado', in_progress: 'em_andamento', completed: 'concluido', cancelled: 'cancelado' }
  for (const appointment of appointments || []) {
    if (localDateKey(appointment.scheduled_at) !== day) continue
    stats.total += 1
    const status = statuses[appointment.status] || appointment.status
    if (Object.hasOwn(stats, status)) stats[status] += 1
    if (['cancelado', 'no_show', 'blocked', 'bloqueado'].includes(status)) continue
    const text = normalizeAppointmentServiceText(appointmentServiceLabel(appointment, services))
    if (/\bbanho\b|\bbath\b/.test(text)) stats.baths += 1
    if (/\btosa\b|\btosagem\b|\bgroom\w*\b|\btrim\w*\b/.test(text)) stats.grooming += 1
  }
  return stats
}
