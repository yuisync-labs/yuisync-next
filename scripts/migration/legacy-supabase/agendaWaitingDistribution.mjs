const waiting = new Set(['scheduled', 'confirmed'])
const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function distributeWaitingGrooming(appointments, services, catalog, staff) {
  const people = staff.filter((person) => person.active !== false)
  if (people.length !== 2 || people[0].key === people[1].key) throw new Error('EXACTLY_TWO_GROOMERS_REQUIRED')
  const byServiceId = new Map(catalog.map((service) => [service.id, service]))
  const byAppointment = new Map()
  for (const item of services) {
    const items = byAppointment.get(item.appointment_id) || []
    items.push(item)
    byAppointment.set(item.appointment_id, items)
  }
  const jobs = appointments.filter((appointment) => (
    waiting.has(appointment.status) && !String(appointment.responsible_staff_key || '').trim()
    && (!appointment.live_status || ['aguardando', 'waiting'].includes(appointment.live_status))
    && appointment.service_group !== 'veterinaria'
    && (appointment.service_group === 'banho_tosa' || (byAppointment.get(appointment.id) || []).some((item) => byServiceId.get(item.service_id)?.group_type === 'banho_tosa'))
  )).sort((a, b) => a.scheduled_at_ms - b.scheduled_at_ms || a.id.localeCompare(b.id)).map((appointment) => {
    let bath = 0, grooming = 0
    for (const item of byAppointment.get(appointment.id) || []) {
      const catalogItem = byServiceId.get(item.service_id)
      const label = normalized([item.service_name, item.service_code, catalogItem?.name].join(' '))
      if (/banho/.test(label)) bath += 1
      if (/tosa/.test(label)) grooming += 1
    }
    return { appointment, bath, grooming }
  })

  // Find a balanced partition by baths, grooming services and appointment count.
  // Prefer alternating chronological assignments when multiple partitions tie.
  const maxCount = Math.ceil(jobs.length / 2)
  let states = new Map([['0:0:0', { count: 0, bath: 0, grooming: 0, cost: 0, mask: 0n }]])
  jobs.forEach((job, index) => {
    const next = new Map()
    for (const state of states.values()) {
      for (const chooseFirst of [false, true]) {
        const candidate = {
          count: state.count + Number(chooseFirst),
          bath: state.bath + (chooseFirst ? job.bath : 0),
          grooming: state.grooming + (chooseFirst ? job.grooming : 0),
          cost: state.cost + Number(chooseFirst !== (index % 2 === 0)),
          mask: chooseFirst ? state.mask | (1n << BigInt(index)) : state.mask,
        }
        if (candidate.count > maxCount) continue
        const key = [candidate.count, candidate.bath, candidate.grooming].join(':')
        if (!next.has(key) || candidate.cost < next.get(key).cost) next.set(key, candidate)
      }
    }
    states = next
  })
  const totalBath = jobs.reduce((sum, job) => sum + job.bath, 0)
  const totalGrooming = jobs.reduce((sum, job) => sum + job.grooming, 0)
  const score = (state) => Math.abs(jobs.length - 2 * state.count) * 1000
    + Math.abs(totalBath - 2 * state.bath) * 100 + Math.abs(totalGrooming - 2 * state.grooming) * 100 + state.cost
  const best = [...states.values()].filter((state) => state.count >= Math.floor(jobs.length / 2))
    .sort((a, b) => score(a) - score(b))[0]
  const assignments = new Map()
  const totals = people.map((person) => ({ key: person.key, name: person.name, appointments: 0, baths: 0, grooming: 0 }))
  jobs.forEach((job, index) => {
    const side = best.mask & (1n << BigInt(index)) ? 0 : 1
    assignments.set(job.appointment.id, { responsible_staff_key: people[side].key, responsible_staff_name: people[side].name })
    totals[side].appointments += 1
    totals[side].baths += job.bath
    totals[side].grooming += job.grooming
  })
  return { assignments, totals }
}
