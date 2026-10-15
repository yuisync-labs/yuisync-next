import {
  appointmentPriceBreakdown,
  localDateKey,
  transportFeeForMode,
} from './agendaOperationalCore.js'
import { appointmentHasTransportBenefit } from '../lib/appointmentPackageUi.js'

export const APPOINTMENT_CHECKOUT_SESSION_KEY = 'yuisync:appointment-checkout'
export const ORDERS_TAB_SESSION_KEY = 'yuisync:orders-tab'
export const APPOINTMENT_CHECKOUT_EVENT = 'yuisync:appointment-checkout-queued'

function activePackageBenefits(appointment = {}) {
  const benefits = Array.isArray(appointment.subscription_benefits) ? appointment.subscription_benefits : []
  return benefits.filter((benefit) => ['reserved', 'consumed'].includes(String(benefit?.status || appointment.subscription_benefit_status || 'reserved')))
}

function itemHasServiceBenefit(item = {}, benefits = [], itemCount = 0) {
  if (item?.benefit_used === true || item?.subscription_benefit_used === true) return true
  const code = String(item?.code || item?.service_type || '').trim()
  const key = String(item?.benefit_key || '').trim()
  const serviceBenefits = benefits.filter((benefit) => benefit?.kind === 'service')
  return serviceBenefits.some((benefit) => {
    const benefitCode = String(benefit?.service_code || '').trim()
    const benefitKey = String(benefit?.key || benefit?.benefit_key || '').trim()
    return (code && benefitCode === code)
      || (key && benefitKey === key)
      || (itemCount === 1 && !benefitCode)
  })
}

export function appointmentCheckoutTotals(appointment = {}, transportOptions = []) {
  const breakdown = appointmentPriceBreakdown(appointment, transportOptions)
  const mode = appointment.transport_mode || appointment.motodog?.mode || 'cliente_leva'
  const catalogTransport = transportFeeForMode(transportOptions, mode)
  const benefits = activePackageBenefits(appointment)
  const transportCovered = appointmentHasTransportBenefit(appointment)
    || benefits.some((benefit) => benefit?.kind === 'transport')
  const netTransport = transportCovered ? 0 : breakdown.transport
  const items = Array.isArray(appointment.service_items) ? appointment.service_items : []
  const catalogServices = items.length
    ? items.reduce((sum, item) => sum + Math.max(0, Number(
      item?.catalog_price
      ?? item?.default_price
      ?? item?.unit_price
      ?? item?.price
      ?? 0,
    )), 0)
    : Math.max(0, Number(appointment.price || 0) - catalogTransport)
  const netServices = items.length
    ? items.reduce((sum, item) => (
      sum + (itemHasServiceBenefit(item, benefits, items.length)
        ? 0
        : Math.max(0, Number(item?.unit_price ?? item?.price ?? item?.default_price ?? 0)))
    ), 0)
    : (benefits.some((benefit) => benefit?.kind === 'service') ? 0 : breakdown.service)
  const total = Math.max(0, netServices + netTransport)
  const catalogTotal = Math.max(total, catalogServices + catalogTransport)

  return {
    service: netServices,
    transport: netTransport,
    catalogTransport,
    catalogTotal,
    total,
    discount: Math.max(0, catalogTotal - total),
  }
}

export function appointmentNeedsPayment(appointment, transportOptions = []) {
  return appointmentCheckoutTotals(appointment, transportOptions).total > 0.005
}

export function queueAppointmentCheckout(appointment = {}) {
  if (typeof window === 'undefined' || !appointment?.id) return null
  const target = {
    appointment_id: String(appointment.id),
    date: localDateKey(appointment.scheduled_at),
    queued_at: new Date().toISOString(),
  }
  window.sessionStorage.setItem(APPOINTMENT_CHECKOUT_SESSION_KEY, JSON.stringify(target))
  window.sessionStorage.setItem(ORDERS_TAB_SESSION_KEY, 'banho_tosa')
  window.dispatchEvent(new CustomEvent(APPOINTMENT_CHECKOUT_EVENT, { detail: target }))
  return target
}

export function readQueuedAppointmentCheckout() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(APPOINTMENT_CHECKOUT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.appointment_id ? parsed : null
  } catch {
    return null
  }
}

export function clearQueuedAppointmentCheckout() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(APPOINTMENT_CHECKOUT_SESSION_KEY)
}
