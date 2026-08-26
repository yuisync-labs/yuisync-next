const normalizeServiceText = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

function appointmentServiceText(appointment = {}) {
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const values = [
    appointment.service_type,
    appointment.service_name,
    appointment.service_label,
  ]

  items.forEach((item) => {
    values.push(
      item?.code,
      item?.value,
      item?.name,
      item?.label,
      item?.service_name,
      item?.service_code,
      item?.service_type,
    )
  })

  return normalizeServiceText(values.filter(Boolean).join(' '))
}

export function appointmentRequiresGroomingMachineNumber(appointment = {}) {
  const serviceText = appointmentServiceText(appointment)
  if (!serviceText) return false

  return /\bmaquina\b|\bmachine\s+grooming\b|\btosa\s+(?:na\s+)?(?:total|completa)\b/.test(serviceText)
}
