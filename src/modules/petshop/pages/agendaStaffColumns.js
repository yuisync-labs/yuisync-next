// Keep appointments assigned to retired/missing staff visible alongside active staff.
export function agendaStaffColumns(staff, appointments) {
  const columns = staff.filter((person) => person.active).map((person) => ({ ...person }))
  const keys = new Set(columns.map((person) => person.key))
  for (const appointment of appointments) {
    const key = appointment.responsible_staff_key
    if (!key || keys.has(key)) continue
    const person = staff.find((item) => item.key === key)
    columns.push({ key, name: person?.name || appointment.responsible_staff_name || 'Responsável não cadastrado', active: false })
    keys.add(key)
  }
  if (!columns.length || appointments.some((item) => !item.responsible_staff_key)) {
    columns.push({ key: '', name: 'Sem responsável' })
  }
  return columns
}
