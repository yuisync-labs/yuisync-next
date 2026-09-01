import { DateTime } from 'luxon'

export const PETSHOP_TIMEZONE = 'America/Sao_Paulo'

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const explicitZonePattern = /(?:Z|[+-]\d{2}:?\d{2})$/i

const parsePetshopDateTime = (value, zone = PETSHOP_TIMEZONE) => {
  if (!value) return null
  if (DateTime.isDateTime(value)) return value.setZone(zone)
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone })

  const text = String(value).trim()
  if (!text) return null
  if (dateOnlyPattern.test(text)) return DateTime.fromISO(text, { zone })

  const parsed = explicitZonePattern.test(text)
    ? DateTime.fromISO(text, { setZone: true }).setZone(zone)
    : DateTime.fromISO(text, { zone })
  return parsed.isValid ? parsed : null
}

export const petshopDateLabel = (value, zone = PETSHOP_TIMEZONE) => {
  const parsed = parsePetshopDateTime(value, zone)
  return parsed?.isValid ? parsed.setLocale('pt-BR').toFormat('dd/MM/yyyy') : '-'
}

export const petshopDateTimeLabel = (value, zone = PETSHOP_TIMEZONE) => {
  const parsed = parsePetshopDateTime(value, zone)
  return parsed?.isValid
    ? parsed.setLocale('pt-BR').toFormat('dd/MM/yyyy HH:mm:ss')
    : '-'
}

export const petshopMonthRange = (now = DateTime.now(), zone = PETSHOP_TIMEZONE) => {
  const current = parsePetshopDateTime(now, zone) || DateTime.now().setZone(zone)
  return {
    startDate: current.startOf('month').toISODate(),
    endDate: current.endOf('month').toISODate(),
  }
}
