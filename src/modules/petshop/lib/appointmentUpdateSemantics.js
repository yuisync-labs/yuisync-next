export const TRANSACTIONAL_APPOINTMENT_EDIT_FIELDS = Object.freeze([
  'services',
  'service_type',
  'service_group',
  'scheduled_at',
  'client_id',
  'pet_id',
])

export const DIRECT_APPOINTMENT_EDIT_FIELDS = Object.freeze([
  'responsible_staff_key',
  'responsible_staff_name',
  'delivery_staff_key',
  'delivery_staff_name',
  'notes',
  'status',
  'transport_mode',
  'transport_label',
  'transport_address',
  'transport_neighborhood',
  'transport_city',
  'transport_reference',
])

export function appointmentUpdateRequiresTransaction(payload = {}) {
  return TRANSACTIONAL_APPOINTMENT_EDIT_FIELDS.some((field) => Boolean(payload?.[field]))
}
