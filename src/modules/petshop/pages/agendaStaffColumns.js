// Only active professionals get timeline columns; other appointments stay in the pending list.
export function agendaStaffColumns(staff = []) {
  return staff.filter((person) => person.active !== false).map((person) => ({ ...person }))
}
