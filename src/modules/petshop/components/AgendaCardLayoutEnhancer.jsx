import { useEffect, useRef } from 'react'

import { supabase } from '../../../lib/supabase'

const STYLES = `
  .yuisync-agenda-card-surface .yuisync-card-content {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    align-content: start !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-header {
    order: 1 !important;
    min-height: 20px !important;
    margin-bottom: 0 !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-body {
    display: contents !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-transport,
  .yuisync-agenda-card-surface[data-yuisync-motodog='false'] .yuisync-card-transport {
    order: 2 !important;
    display: block !important;
    min-width: 0 !important;
    margin: 0 0 2px !important;
    font-size: 8.5px !important;
    line-height: 1.05 !important;
    font-weight: 800 !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-transport > p:first-child {
    display: flex !important;
    min-width: 0 !important;
    margin: 0 !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-transport > p:not(:first-child) {
    display: none !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-pet { order: 3 !important; }
  .yuisync-agenda-card-surface .yuisync-card-tutor { order: 4 !important; }
  .yuisync-agenda-card-surface .yuisync-card-service { order: 5 !important; }
  .yuisync-agenda-card-surface .yuisync-card-responsible { order: 6 !important; }

  .yuisync-agenda-card-surface .yuisync-card-pet,
  .yuisync-agenda-card-surface .yuisync-card-tutor,
  .yuisync-agenda-card-surface .yuisync-card-service > span:first-child {
    white-space: normal !important;
    overflow-wrap: anywhere !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-density='comfortable'] .yuisync-card-pet,
  .yuisync-agenda-card-surface[data-yuisync-density='comfortable'] .yuisync-card-tutor,
  .yuisync-agenda-card-surface[data-yuisync-density='compact'] .yuisync-card-pet,
  .yuisync-agenda-card-surface[data-yuisync-density='compact'] .yuisync-card-tutor {
    -webkit-line-clamp: 2 !important;
  }

  /* O responsavel cabe mesmo com tres ou mais cards: nunca esconder por densidade. */
  .yuisync-agenda-card-surface[data-yuisync-density='compact'] .yuisync-card-responsible,
  .yuisync-agenda-card-surface[data-yuisync-density='dense'] .yuisync-card-responsible,
  .yuisync-agenda-card-surface[data-yuisync-density='micro'] .yuisync-card-responsible {
    display: block !important;
    min-width: 0 !important;
    margin-top: 1px !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    font-size: 8.5px !important;
    line-height: 1.05 !important;
  }

  /* Pacote ocupa a mesma coluna visual do valor, sem criar uma linha extra. */
  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-card-tutor {
    display: block !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    -webkit-line-clamp: unset !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-card-service {
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: start !important;
    gap: 5px !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-card-service > span:first-child {
    grid-column: 1 !important;
    min-width: 0 !important;
    -webkit-line-clamp: 2 !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-package-label {
    grid-column: 2 !important;
    display: block !important;
    align-self: start !important;
    width: auto !important;
    max-width: none !important;
    overflow: visible !important;
    color: transparent !important;
    font-size: 0 !important;
    line-height: 1 !important;
    white-space: nowrap !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-package-label::before {
    content: 'PACOTE';
    color: #fef3c7;
    font-size: 9px;
    line-height: 1.1;
    font-weight: 900;
    letter-spacing: .03em;
    white-space: nowrap;
  }
`

const ACTIVE_PACKAGE_BENEFIT_STATUSES = new Set(['reserved', 'consumed'])
const RELEASED_PACKAGE_BENEFIT_STATUSES = new Set(['released', 'cancelled', 'canceled'])

export function appointmentUsesPackage(appointment = {}) {
  const benefitStatus = String(appointment.subscription_benefit_status || '').trim().toLowerCase()
  const serviceItems = Array.isArray(appointment.service_items) ? appointment.service_items : []

  if (ACTIVE_PACKAGE_BENEFIT_STATUSES.has(benefitStatus)) return true
  if (appointment.subscription_benefit_used === true) return true
  if (serviceItems.some((item) => (
    item?.benefit_used === true
    || ACTIVE_PACKAGE_BENEFIT_STATUSES.has(String(item?.benefit_status || '').trim().toLowerCase())
  ))) return true

  return Boolean(appointment.subscription_id) && !RELEASED_PACKAGE_BENEFIT_STATUSES.has(benefitStatus)
}

function packageCardIds() {
  return [...document.querySelectorAll('[data-yuisync-native-appointment-id]')]
    .map((card) => String(card.dataset.yuisyncNativeAppointmentId || '').trim())
    .filter(Boolean)
}

function applyPackageMarkers(rows = []) {
  const appointmentsById = new Map((rows || []).map((appointment) => [String(appointment.id), appointment]))

  document.querySelectorAll('[data-yuisync-native-appointment-id]').forEach((card) => {
    const appointment = appointmentsById.get(String(card.dataset.yuisyncNativeAppointmentId || ''))
    if (!appointment) return

    const usesPackage = appointmentUsesPackage(appointment)
    card.dataset.yuisyncPackage = String(usesPackage)

    if (usesPackage) {
      card.dataset.yuisyncCardKind = 'package'
      const priceNode = card.querySelector('.yuisync-card-service > span:last-child')
      if (priceNode) {
        priceNode.textContent = 'PACOTE · R$ 0,00'
        priceNode.classList.add('yuisync-package-label')
      }
    }
  })
}

export function AgendaCardLayoutEnhancer() {
  const lastIdsRef = useRef('')
  const refreshTokenRef = useRef(0)

  useEffect(() => {
    let disposed = false
    let frame = 0

    const syncPackageCards = async ({ force = false } = {}) => {
      const ids = [...new Set(packageCardIds())].sort()
      const signature = ids.join('|')
      if (!ids.length) {
        lastIdsRef.current = ''
        return
      }
      if (!force && signature === lastIdsRef.current) return
      lastIdsRef.current = signature

      const requestToken = ++refreshTokenRef.current
      const { data, error } = await supabase
        .from('appointments')
        .select('id, subscription_id, subscription_benefit_used, subscription_benefit_status, service_items')
        .in('id', ids)

      if (disposed || requestToken !== refreshTokenRef.current) return
      if (error) {
        console.warn('Falha ao identificar pacotes nos cards da agenda:', error.message)
        return
      }
      applyPackageMarkers(data || [])
    }

    const schedule = ({ force = false } = {}) => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        void syncPackageCards({ force })
      })
    }

    const observer = new MutationObserver(() => schedule())
    observer.observe(document.body, { childList: true, subtree: true })

    const handleAppointmentSync = () => schedule({ force: true })
    window.addEventListener('yuisync:appointments-sync', handleAppointmentSync)
    schedule({ force: true })

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('yuisync:appointments-sync', handleAppointmentSync)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return <style>{STYLES}</style>
}
