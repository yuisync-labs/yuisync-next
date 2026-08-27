import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AgendaPage from './AgendaPage'
import { useAppointments } from '../../../shared/hooks/useAppointments'
import { useAuthCtx } from '../../../context/AuthContext'
import { fmtCurrency, todayISO } from '../../../lib/supabase'
import { printThermalReceipt } from '../../../lib/thermalPrint'
import {
  normalizeServiceDurations,
  resolvePetshopServiceDuration,
} from '../../../../shared/petshopOperations'
import {
  appointmentInterval,
  appointmentPriceBreakdown,
  chooseAgendaSlot,
  findAgendaCardCandidate,
  isoDate,
  localDateKey,
  moneyNumber,
  normalizeText,
  normalizeTransportOptions,
  parseAgendaDate,
  slotTimeFromAria,
  transportFeeForMode,
} from './agendaOperationalCore'
import { appointmentCheckoutTotals, queueAppointmentCheckout } from './appointmentCheckoutFlow'
import './AgendaResolvedPage.css'

const NON_OPERATIONAL_STATUSES = new Set(['cancelado', 'no_show'])

const ICONS = {
  cancel: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  print: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
}

const escapeHtml = (value = '') => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

function appointmentServiceText(appointment, serviceLabel) {
  const items = Array.isArray(appointment?.service_items) ? appointment.service_items : []
  const names = items
    .map((item) => item?.name || item?.label || item?.service_name || serviceLabel(item?.code || item?.service_type))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  return names.length > 0 ? names.join(', ') : (serviceLabel(appointment?.service_type) || 'Servico nao informado')
}

function receiptShell({ storeSettings, title, content }) {
  const logo = String(
    storeSettings?.receipt_logo_data_url
    || storeSettings?.store_logo_url
    || storeSettings?.logo_url
    || `${window.location.origin}/brand/quatro-patas-logo-mono.png`,
  )
  const header = `<img class="print-logo" src="${escapeHtml(logo)}" alt="Logo da empresa"/>`

  return `
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { margin: 0; }
          * { box-sizing: border-box; }
          html, body { width: 80mm; margin: 0; padding: 0; color: #000; background: #fff; }
          body { font-family: Arial, Helvetica, sans-serif; padding: 3mm 2mm; }
          .receipt { width: 72mm; max-width: 72mm; margin: 0 auto; }
          .center { text-align: center; }
          .print-logo { display:block; width:auto; max-width:56mm; max-height:22mm; margin:0 auto 2.5mm; object-fit:contain; filter:grayscale(1) contrast(2); }
          .store { font-size: 15px; font-weight: 900; text-transform: uppercase; }
          .store-line { margin-top: 1px; font-size: 9px; line-height: 1.25; overflow-wrap: anywhere; }
          .title { margin: 3mm 0 2mm; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 1.6mm 0; font-size: 13.5px; font-weight: 900; }
          .details { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 1.5mm 0; }
          .line { display: grid; grid-template-columns: 18mm minmax(0, 1fr); gap: 1.5mm; padding: .8mm 0; font-size: 11px; line-height: 1.32; }
          .line strong { font-size: 10px; text-transform: uppercase; }
          .line span { min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
          .appointment { padding: 1.8mm 0; border-bottom: 1px dashed #000; page-break-inside: avoid; }
          .appointment-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2mm; font-size: 11px; font-weight: 900; }
          .appointment-line { margin-top: .8mm; font-size: 10px; line-height: 1.32; overflow-wrap: anywhere; }
          .footer { margin-top: 3mm; font-size: 8.5px; line-height: 1.3; }
          @media print { body { position: absolute; inset: 0 auto auto 0; } }
        </style>
      </head>
      <body>
        <main class="receipt">
          <div class="center">
            ${header}
            <div class="title">${escapeHtml(title)}</div>
          </div>
          ${content}
          <div class="footer center">Impresso em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</div>
        </main>
      </body>
    </html>
  `
}

function writeAndPrint(html) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  printWindow.document.write(html)
  printWindow.document.close()

  let printed = false
  const printWhenReady = () => {
    if (printed) return
    printed = true
    printThermalReceipt(printWindow)
  }
  const images = [...printWindow.document.images]
  const pendingImages = images.filter((image) => !image.complete)
  if (pendingImages.length === 0) {
    window.setTimeout(printWhenReady, 80)
  } else {
    let remaining = pendingImages.length
    const settleImage = () => {
      remaining -= 1
      if (remaining <= 0) window.setTimeout(printWhenReady, 80)
    }
    pendingImages.forEach((image) => {
      image.addEventListener('load', settleImage, { once: true })
      image.addEventListener('error', settleImage, { once: true })
    })
    window.setTimeout(printWhenReady, 1500)
  }
  return true
}

function findScrollableAncestor(element) {
  let current = element?.parentElement || null
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return document.scrollingElement || document.documentElement
}

function ResolvedAgendaOperations({ setPage, agendaPeriod }) {
  const { storeSettings } = useAuthCtx()
  const {
    appointments,
    load,
    update,
    updateStatus,
    serviceLabel,
    statusBadge,
  } = useAppointments()
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [notice, setNotice] = useState('')
  const dragRef = useRef(null)
  const lastDragAtRef = useRef(0)
  const autoScrollFrameRef = useRef(0)
  const transportOptions = useMemo(() => normalizeTransportOptions(storeSettings), [storeSettings])

  const operationalAppointments = useMemo(() => (
    (appointments || [])
      .filter((appointment) => !NON_OPERATIONAL_STATUSES.has(appointment.status))
      .filter((appointment) => localDateKey(appointment.scheduled_at) === selectedDate)
      .sort((left, right) => {
        const leftFinished = left.status === 'concluido' ? 1 : 0
        const rightFinished = right.status === 'concluido' ? 1 : 0
        return (leftFinished - rightFinished) || (new Date(left.scheduled_at) - new Date(right.scheduled_at))
      })
  ), [appointments, selectedDate])

  useEffect(() => {
    void load({ date: selectedDate })
  }, [load, selectedDate])

  const printAppointment = useCallback((appointment) => {
    const pet = appointment?.pets || {}
    const status = statusBadge(appointment.status).label
    const title = appointment.status === 'concluido' ? 'FICHA DE ATENDIMENTO' : 'FICHA DE AGENDAMENTO'
    const responsible = appointment.responsible_staff_name || appointment.responsible_staff_key || 'Nao informado'
    const date = new Date(appointment.scheduled_at || '')
    const dateText = Number.isNaN(date.getTime()) ? 'Nao informada' : date.toLocaleDateString('pt-BR')
    const line = (label, value) => `<div class="line"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || 'Nao informado')}</span></div>`
    const content = `
      <div class="details">
        ${line('Status', status)}
        ${line('Tutor', pet.owner_name)}
        ${line('Pet', pet.pet_name)}
        ${line('Raca', pet.breed || pet.species)}
        ${line('Data e hora', `${dateText} - ${appointmentInterval(appointment)}`)}
        ${line('Servico', appointmentServiceText(appointment, serviceLabel))}
        ${line('Resp.', responsible)}
        ${line('Obs.', appointment.notes || 'Nenhuma observacao')}
      </div>
    `
    const opened = writeAndPrint(receiptShell({ storeSettings, title, content }))
    setNotice(opened ? '' : 'O navegador bloqueou a janela de impressao. Libere pop-ups para o YuiSync.')
  }, [serviceLabel, statusBadge, storeSettings])

  const printDay = useCallback(() => {
    const rows = operationalAppointments.map((appointment, index) => {
      const pet = appointment?.pets || {}
      const status = statusBadge(appointment.status).label
      return `
        <section class="appointment">
          <div class="appointment-title"><span>${escapeHtml(`${index + 1}. ${appointmentInterval(appointment)}`)}</span><span>${escapeHtml(status)}</span></div>
          <div class="appointment-line"><strong>${escapeHtml(pet.pet_name || 'Pet')}</strong> - Tutor: ${escapeHtml(pet.owner_name || 'Cliente')}</div>
          <div class="appointment-line">Servico: ${escapeHtml(appointmentServiceText(appointment, serviceLabel))}</div>
          ${appointment.notes ? `<div class="appointment-line">Obs.: ${escapeHtml(appointment.notes)}</div>` : ''}
        </section>
      `
    }).join('')
    const date = new Date(`${selectedDate}T12:00:00`)
    const content = `
      <div class="details">
        <div class="line"><strong>Data</strong><span>${escapeHtml(date.toLocaleDateString('pt-BR'))}</span></div>
        <div class="line"><strong>Total</strong><span>${operationalAppointments.length} agendamento(s)</span></div>
      </div>
      ${rows || '<div class="appointment-line">Nenhum agendamento operacional nesta data.</div>'}
    `
    const opened = writeAndPrint(receiptShell({ storeSettings, title: 'AGENDA DO DIA', content }))
    setNotice(opened ? '' : 'O navegador bloqueou a janela de impressao. Libere pop-ups para o YuiSync.')
  }, [operationalAppointments, selectedDate, serviceLabel, statusBadge, storeSettings])

  const completeAppointment = useCallback(async (appointmentId) => {
    setNotice('')
    try {
      const updated = await updateStatus(appointmentId, 'concluido')
      if (!updated) return
      const totals = appointmentCheckoutTotals(updated, transportOptions)
      if (totals.total <= 0.005) {
        printAppointment(updated)
        setNotice('Atendimento coberto pelo pacote. Nenhuma nova venda foi criada.')
        return
      }
      queueAppointmentCheckout(updated)
      setPage?.('ordens')
    } catch (error) {
      setNotice(error?.message || 'Nao foi possivel concluir o agendamento.')
    }
  }, [printAppointment, setPage, transportOptions, updateStatus])

  const cancelAppointment = useCallback(async (appointmentId) => {
    setNotice('')
    try {
      await updateStatus(appointmentId, 'cancelado')
      setNotice('Agendamento cancelado.')
    } catch (error) {
      setNotice(error?.message || 'Nao foi possivel cancelar o agendamento.')
    }
  }, [updateStatus])

  const moveAppointment = useCallback(async (appointmentId, timeText) => {
    const appointment = operationalAppointments.find((item) => String(item.id) === String(appointmentId))
    if (!appointment || appointment.status === 'concluido' || NON_OPERATIONAL_STATUSES.has(appointment.status)) return
    const match = String(timeText || '').match(/(\d{2}):(\d{2})/)
    if (!match) return

    const [year, month, day] = selectedDate.split('-').map(Number)
    const target = new Date(year, month - 1, day, Number(match[1]), Number(match[2]), 0, 0)
    const current = new Date(appointment.scheduled_at)
    if (!Number.isNaN(current.getTime()) && current.getTime() === target.getTime()) return

    setNotice('')
    try {
      await update(appointmentId, { scheduled_at: target.toISOString() })
      setNotice(`Agendamento movido para ${match[1]}:${match[2]}.`)
    } catch (error) {
      setNotice(error?.message || 'Horario indisponivel para este agendamento.')
    }
  }, [operationalAppointments, selectedDate, update])

  useEffect(() => {
    const pageRoot = document.querySelector('.page')
    if (!pageRoot) return undefined
    let syncFrame = 0
    let reloadTimer = 0
    let reloadPending = false
    let lastUnresolvedSignature = ''
    let unresolvedAttempts = 0
    let dragMoveFrame = 0

    const syncDate = () => {
      const parsed = parseAgendaDate(pageRoot.querySelector('.page-sub')?.textContent || '')
      if (parsed) setSelectedDate((current) => current === isoDate(parsed) ? current : isoDate(parsed))
    }

    const isDailyAgenda = () => agendaPeriod === 'day'

    const slots = () => pageRoot.querySelectorAll('button[aria-label^="Agendar as "]')

    const clearDropHighlight = () => {
      pageRoot.querySelector('[data-yuisync-drop-active]')?.removeAttribute('data-yuisync-drop-active')
    }

    const setActiveSlot = (slot) => {
      const state = dragRef.current
      if (state?.slot === slot) return
      state?.slot?.removeAttribute('data-yuisync-drop-active')
      if (state) state.slot = null
      if (!slot || !isDailyAgenda()) return
      slot.dataset.yuisyncDropActive = 'true'
      if (state) state.slot = slot
    }

    const stopAutoScroll = () => {
      if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = 0
    }

    const stopDragMove = () => {
      if (dragMoveFrame) cancelAnimationFrame(dragMoveFrame)
      dragMoveFrame = 0
    }

    const resetDrag = () => {
      stopAutoScroll()
      stopDragMove()
      const state = dragRef.current
      if (state?.pointerId != null && state.card?.hasPointerCapture?.(state.pointerId)) {
        state.card.releasePointerCapture(state.pointerId)
      }
      dragRef.current?.ghost?.remove()
      dragRef.current?.card?.classList.remove('is-yuisync-pointer-dragging')
      dragRef.current = null
      document.body.style.userSelect = ''
      document.body.classList.remove('yuisync-agenda-is-dragging')
      clearDropHighlight()
    }

    const updateDragVisuals = () => {
      dragMoveFrame = 0
      const state = dragRef.current
      if (!state?.active || !state.ghost) return

      const left = state.clientX - state.ghostOffsetX
      const top = state.clientY - state.ghostOffsetY
      state.ghost.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.012)`
      setActiveSlot(chooseAgendaSlot(slots(), state.clientX, state.clientY))
    }

    const scheduleDragVisuals = () => {
      if (dragMoveFrame) return
      dragMoveFrame = requestAnimationFrame(updateDragVisuals)
    }

    const settleDrop = (state, slot) => {
      stopAutoScroll()
      stopDragMove()
      state.slot?.removeAttribute('data-yuisync-drop-active')
      if (state.pointerId != null && state.card?.hasPointerCapture?.(state.pointerId)) {
        state.card.releasePointerCapture(state.pointerId)
      }
      dragRef.current = null
      document.body.style.userSelect = ''
      document.body.classList.remove('yuisync-agenda-is-dragging')

      if (!state.ghost || !slot) {
        state.ghost?.remove()
        state.card?.classList.remove('is-yuisync-pointer-dragging')
        return
      }

      const target = slot.getBoundingClientRect()
      slot.dataset.yuisyncDropCommitting = 'true'
      state.ghost.classList.add('is-dropping')
      state.ghost.style.transform = `translate3d(${target.left + 8}px, ${target.top + 2}px, 0) scale(0.94)`
      state.ghost.style.opacity = '0'
      window.setTimeout(() => {
        state.ghost?.remove()
        state.card?.classList.remove('is-yuisync-pointer-dragging')
        slot.removeAttribute('data-yuisync-drop-committing')
      }, 170)
    }

    const autoScrollTick = () => {
      const state = dragRef.current
      if (!state?.active) {
        autoScrollFrameRef.current = 0
        return
      }

      const margin = 92
      const maxSpeed = 15
      const scrollParent = state.scrollParent
      let top = 0
      let bottom = window.innerHeight
      if (scrollParent && scrollParent !== document.scrollingElement && scrollParent !== document.documentElement) {
        const rect = scrollParent.getBoundingClientRect()
        top = rect.top
        bottom = rect.bottom
      }

      let delta = 0
      if (state.clientY < top + margin) {
        const intensity = 1 - Math.max(0, state.clientY - top) / margin
        delta = -Math.ceil(maxSpeed * intensity * intensity)
      }
      if (state.clientY > bottom - margin) {
        const intensity = 1 - Math.max(0, bottom - state.clientY) / margin
        delta = Math.ceil(maxSpeed * intensity * intensity)
      }

      if (delta !== 0) {
        if (scrollParent && scrollParent !== document.scrollingElement && scrollParent !== document.documentElement) {
          scrollParent.scrollTop += delta
        } else {
          window.scrollBy(0, delta)
        }
        scheduleDragVisuals()
      }

      autoScrollFrameRef.current = requestAnimationFrame(autoScrollTick)
    }

    const syncModal = () => {
      const serviceInput = document.querySelector('input[aria-label="Buscar servico para adicionar"]')
      const modal = serviceInput?.closest('.modal-box')
      if (!modal) return

      const transportSelect = modal.querySelector('select[aria-label="Transporte do pet"]')
      const totalLabel = [...modal.querySelectorAll('span')].find((element) => normalizeText(element.textContent) === 'valor total')
      const totalCard = totalLabel?.parentElement
      const totalValue = totalCard?.querySelector('strong')
      if (totalCard && totalValue) {
        let target = totalCard.querySelector('[data-yuisync-modal-total]')
        if (!target) {
          target = document.createElement('div')
          target.dataset.yuisyncModalTotal = 'true'
          target.className = 'w-full'
          ;[...totalCard.children].forEach((child) => {
            if (child !== target) child.style.display = 'none'
          })
          totalCard.appendChild(target)
        }
        const serviceTotal = moneyNumber(totalValue.textContent)
        const transportFee = transportFeeForMode(transportOptions, transportSelect?.value || 'cliente_leva')
        target.innerHTML = `
          <div class="space-y-1 text-sm">
            <div class="flex items-center justify-between gap-3 text-muted"><span>Servico</span><strong class="text-text">${fmtCurrency(serviceTotal)}</strong></div>
            <div class="flex items-center justify-between gap-3 text-muted"><span>Transporte</span><strong class="text-text">${fmtCurrency(transportFee)}</strong></div>
            <div class="mt-2 flex items-center justify-between gap-3 border-t border-emerald-500/25 pt-2"><span class="font-black uppercase tracking-wider text-emerald-500">Total</span><strong class="text-xl text-emerald-500">${fmtCurrency(serviceTotal + transportFee)}</strong></div>
          </div>
        `
      }

      const durations = normalizeServiceDurations(storeSettings?.petshop_service_durations)
      modal.querySelectorAll('[role="listbox"][aria-label="Servicos encontrados"] button').forEach((button) => {
        const spans = button.querySelectorAll('span')
        const label = spans.length >= 2 ? spans[spans.length - 2]?.textContent : ''
        const detail = spans.length ? spans[spans.length - 1] : null
        if (!label || !detail || !/\d+\s*min/i.test(detail.textContent || '')) return
        const duration = resolvePetshopServiceDuration({
          service: { label },
          durations,
          fallbackMin: Number((detail.textContent || '').match(/(\d+)\s*min/i)?.[1] || 60),
        })
        detail.textContent = String(detail.textContent).replace(/\d+\s*min/i, `${duration} min`)
      })
    }

    const compactCard = (card, trigger) => {
      const transportBlock = [...trigger.querySelectorAll('div')].find((element) => {
        const firstLine = element.querySelector(':scope > p:first-child')
        const text = normalizeText(firstLine?.textContent)
        return text.includes('motodog') || text.includes('cliente traz e busca')
      })
      if (transportBlock) {
        ;[...transportBlock.children].slice(1).forEach((detail) => detail.classList.add('yuisync-resolved-detail-hidden'))
        transportBlock.style.marginTop = '3px'
      }

      const responsible = [...trigger.querySelectorAll('p')]
        .find((element) => normalizeText(element.textContent).startsWith('resp.:'))
      if (responsible) responsible.style.marginTop = '2px'

      card.querySelectorAll('button').forEach((button) => {
        if (button.closest('[data-yuisync-resolved-actions]')) return
        const label = normalizeText(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`)
        if (label.includes('imprimir')) button.classList.add('yuisync-resolved-native-print-hidden')
      })
    }

    const actionMarkup = (canCancel, canComplete) => `
      ${canCancel ? `<button type="button" data-yuisync-action="cancel" class="yuisync-resolved-action is-cancel" aria-label="Cancelar agendamento" title="Cancelar agendamento">${ICONS.cancel}</button>` : ''}
      <button type="button" data-yuisync-action="print" class="yuisync-resolved-action" aria-label="Imprimir agendamento" title="Imprimir agendamento">${ICONS.print}</button>
      ${canComplete ? `<button type="button" data-yuisync-action="complete" class="yuisync-resolved-action is-complete" aria-label="Concluir agendamento" title="Concluir agendamento">${ICONS.check}</button>` : ''}
    `

    const cleanupCards = () => {
      pageRoot.querySelectorAll('[data-yuisync-resolved-actions]').forEach((node) => node.remove())
      pageRoot.querySelectorAll('.yuisync-resolved-card').forEach((card) => {
        card.classList.remove('yuisync-resolved-card', 'is-movable')
        card.removeAttribute('data-yuisync-appointment-id')
        card.removeAttribute('data-yuisync-movable')
      })
    }

    const syncCards = () => {
      syncFrame = 0
      syncDate()
      const daily = isDailyAgenda()
      if (!daily) {
        cleanupCards()
        syncModal()
        return
      }

      const candidates = [...pageRoot.querySelectorAll('button.w-full.text-left')]
      const usedCards = new Set()

      operationalAppointments.forEach((appointment) => {
        const nativeCard = [...pageRoot.querySelectorAll('[data-yuisync-native-appointment-id]')]
          .find((node) => node.dataset.yuisyncNativeAppointmentId === String(appointment.id))
        const statusLabel = statusBadge(appointment.status).label
        const trigger = nativeCard?.querySelector(':scope > button.w-full.text-left') || findAgendaCardCandidate(candidates, {
          interval: appointmentInterval(appointment),
          petName: appointment?.pets?.pet_name || 'pet',
          statusLabel,
        }, usedCards)
        if (!trigger) return

        const card = nativeCard || trigger.parentElement
        if (!card || !card.classList.contains('relative')) return
        usedCards.add(trigger)

        const movable = appointment.status !== 'concluido' && !NON_OPERATIONAL_STATUSES.has(appointment.status)
        const canComplete = appointment.status !== 'concluido'
        card.dataset.yuisyncAppointmentId = String(appointment.id)
        card.dataset.yuisyncMovable = String(movable)
        card.classList.add('yuisync-resolved-card')
        card.classList.toggle('is-movable', movable)
        card.title = movable ? 'Arraste o card para mudar o horario' : card.title

        const outer = card.parentElement
        if (outer?.classList.contains('absolute')) outer.classList.add('yuisync-resolved-outer')

        compactCard(card, trigger)
        const prices = appointmentPriceBreakdown(appointment, transportOptions)
        const priceSpan = [...trigger.querySelectorAll('span')]
          .find((element) => /^r\$\s*/i.test(String(element.textContent || '').trim()))
        if (priceSpan) priceSpan.textContent = fmtCurrency(prices.total)

        let actions = card.querySelector('[data-yuisync-resolved-actions]')
        if (!actions) {
          actions = document.createElement('div')
          actions.dataset.yuisyncResolvedActions = 'true'
          actions.className = 'yuisync-resolved-actions'
          card.appendChild(actions)
        }
        const signature = `${appointment.id}:${movable}:${canComplete}`
        if (actions.dataset.yuisyncSignature !== signature) {
          actions.dataset.yuisyncSignature = signature
          actions.innerHTML = actionMarkup(movable, canComplete)
        }
      })

      const header = pageRoot.querySelector('.page-header')
      if (header && !header.querySelector('[data-yuisync-print-day]')) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.yuisyncPrintDay = 'true'
        button.className = 'btn btn-secondary gap-2'
        button.title = 'Imprimir os agendamentos desta data'
        button.innerHTML = `${ICONS.print}<span>Imprimir dia</span>`
        header.appendChild(button)
      }
      syncModal()
    }

    const scheduleSync = () => {
      if (syncFrame) return
      syncFrame = requestAnimationFrame(syncCards)
    }

    const scheduleOperationalReload = () => {
      if (!isDailyAgenda() || reloadPending || reloadTimer) return
      const unresolved = [...pageRoot.querySelectorAll('[data-yuisync-native-agenda-card="true"]:not(.yuisync-resolved-card)')]
      if (!unresolved.length) {
        lastUnresolvedSignature = ''
        unresolvedAttempts = 0
        return
      }
      const signature = unresolved
        .map((card) => card.dataset.yuisyncNativeAppointmentId || '')
        .filter(Boolean)
        .sort()
        .join('|')
      if (signature === lastUnresolvedSignature && unresolvedAttempts >= 2) return
      if (signature !== lastUnresolvedSignature) {
        lastUnresolvedSignature = signature
        unresolvedAttempts = 0
      }
      unresolvedAttempts += 1
      reloadTimer = window.setTimeout(async () => {
        reloadTimer = 0
        reloadPending = true
        try {
          await load({ date: selectedDate })
        } finally {
          reloadPending = false
          scheduleSync()
        }
      }, 120)
    }

    const onPointerDown = (event) => {
      if (event.button !== 0) return
      const card = event.target.closest?.('[data-yuisync-appointment-id]')
      if (!card || card.dataset.yuisyncMovable !== 'true') return
      const action = event.target.closest?.('[data-yuisync-action]')
      if (action) return

      dragRef.current = {
        id: card.dataset.yuisyncAppointmentId,
        card,
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        active: false,
        slot: null,
        ghost: null,
        ghostOffsetX: 44,
        ghostOffsetY: 24,
        scrollParent: findScrollableAncestor(card),
      }
    }

    const onPointerMove = (event) => {
      const state = dragRef.current
      if (!state) return
      state.clientX = event.clientX
      state.clientY = event.clientY
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
      if (!state.active && distance < 7) return

      if (!state.active) {
        state.active = true
        state.card.classList.add('is-yuisync-pointer-dragging')
        const rect = state.card.getBoundingClientRect()
        state.ghostOffsetX = Math.min(Math.max(event.clientX - rect.left, 28), Math.max(28, Math.min(rect.width - 28, 64)))
        state.ghostOffsetY = Math.min(Math.max(event.clientY - rect.top, 18), Math.max(18, Math.min(rect.height - 18, 48)))
        const ghost = state.card.cloneNode(true)
        ghost.querySelectorAll('[data-yuisync-resolved-actions]').forEach((node) => node.remove())
        ghost.classList.add('yuisync-resolved-drag-ghost')
        ghost.style.width = `${rect.width}px`
        ghost.style.height = `${Math.min(rect.height, 180)}px`
        document.body.appendChild(ghost)
        state.ghost = ghost
        state.card.setPointerCapture?.(state.pointerId)
        document.body.style.userSelect = 'none'
        document.body.classList.add('yuisync-agenda-is-dragging')
        autoScrollFrameRef.current = requestAnimationFrame(autoScrollTick)
      }

      event.preventDefault()
      scheduleDragVisuals()
    }

    const onPointerUp = (event) => {
      const state = dragRef.current
      if (!state) return
      if (!state.active) {
        resetDrag()
        return
      }

      event.preventDefault()
      // O requestAnimationFrame da pre-visualizacao pode estar um quadro atrasado.
      // A soltura sempre deve usar a posicao final do ponteiro como fonte de verdade.
      const slot = chooseAgendaSlot(slots(), event.clientX, event.clientY) || state.slot
      const time = slotTimeFromAria(slot)
      const id = state.id
      lastDragAtRef.current = Date.now()
      settleDrop(state, slot)
      if (id && time) void moveAppointment(id, time)
    }

    const onClickCapture = (event) => {
      if (Date.now() - lastDragAtRef.current > 500) return
      if (!event.target.closest?.('[data-yuisync-appointment-id]')) return
      event.preventDefault()
      event.stopPropagation()
    }

    const onClick = (event) => {
      const action = event.target.closest?.('[data-yuisync-action]')
      if (action) {
        event.preventDefault()
        event.stopPropagation()
        const card = action.closest('[data-yuisync-appointment-id]')
        const appointment = operationalAppointments.find((item) => String(item.id) === String(card?.dataset?.yuisyncAppointmentId))
        if (!appointment) return
        if (action.dataset.yuisyncAction === 'cancel') void cancelAppointment(appointment.id)
        if (action.dataset.yuisyncAction === 'print') printAppointment(appointment)
        if (action.dataset.yuisyncAction === 'complete') void completeAppointment(appointment.id)
        return
      }

      if (event.target.closest?.('[data-yuisync-print-day]')) {
        event.preventDefault()
        printDay()
        return
      }

      const serviceOption = event.target.closest?.('[role="listbox"][aria-label="Servicos encontrados"] button')
      if (serviceOption) {
        window.setTimeout(() => {
          const input = document.querySelector('input[aria-label="Buscar servico para adicionar"]')
          input?.blur()
          document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          syncModal()
        }, 30)
      } else {
        window.setTimeout(syncModal, 0)
      }
    }

    const onChange = (event) => {
      if (event.target?.matches?.('select[aria-label="Transporte do pet"]')) syncModal()
    }

    syncCards()
    scheduleOperationalReload()
    const observer = new MutationObserver(() => {
      scheduleSync()
      scheduleOperationalReload()
    })
    observer.observe(pageRoot, { childList: true, subtree: true })
    pageRoot.addEventListener('pointerdown', onPointerDown)
    pageRoot.addEventListener('click', onClickCapture, true)
    pageRoot.addEventListener('click', onClick)
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp, { passive: false })
    document.addEventListener('pointercancel', resetDrag)
    document.addEventListener('change', onChange)

    return () => {
      if (syncFrame) cancelAnimationFrame(syncFrame)
      stopDragMove()
      if (reloadTimer) window.clearTimeout(reloadTimer)
      observer.disconnect()
      pageRoot.removeEventListener('pointerdown', onPointerDown)
      pageRoot.removeEventListener('click', onClickCapture, true)
      pageRoot.removeEventListener('click', onClick)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', resetDrag)
      document.removeEventListener('change', onChange)
      resetDrag()
      pageRoot.querySelectorAll('[data-yuisync-resolved-actions], [data-yuisync-print-day]').forEach((node) => node.remove())
    }
  }, [agendaPeriod, cancelAppointment, completeAppointment, load, moveAppointment, operationalAppointments, printAppointment, printDay, selectedDate, statusBadge, storeSettings?.petshop_service_durations, transportOptions])

  return notice ? (
    <button
      type="button"
      onClick={() => setNotice('')}
      className="fixed right-5 top-5 z-[100] max-w-sm rounded-xl border border-amber-300/25 bg-surface px-4 py-3 text-left text-sm font-semibold text-text shadow-2xl"
      title="Fechar aviso"
    >
      {notice}
    </button>
  ) : null
}

export default function AgendaResolvedPage({ setPage }) {
  const [agendaPeriod, setAgendaPeriod] = useState('day')

  return (
    <>
      <AgendaPage
        setPage={setPage}
        agendaPeriod={agendaPeriod}
        onAgendaPeriodChange={setAgendaPeriod}
      />
      <ResolvedAgendaOperations setPage={setPage} agendaPeriod={agendaPeriod} />
    </>
  )
}
