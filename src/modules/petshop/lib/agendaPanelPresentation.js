export function appointmentPanelAction(status = '') {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'agendado' || normalized === 'scheduled') return { status: 'confirmado', label: 'Confirmar' }
  if (normalized === 'confirmado' || normalized === 'confirmed') return { status: 'em_andamento', label: 'Iniciar' }
  if (normalized === 'em_andamento' || normalized === 'in_progress') return { status: 'concluido', label: 'Concluir' }
  return null
}

export function appointmentHistoryRows(items = [], currentAppointmentId = null, limit = 12) {
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item?.id)
    .sort((left, right) => new Date(right?.scheduled_at || 0) - new Date(left?.scheduled_at || 0))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 12)))
    .map((item) => ({
      ...item,
      current: String(item.id) === String(currentAppointmentId || ''),
    }))
}

export function appointmentPaymentPresentation({ appointment = {}, needsPayment = false, total = 0, usesPackage = false } = {}) {
  const completed = ['concluido', 'completed', 'finalizado', 'finalizada'].includes(String(appointment.status || '').toLowerCase())
  const amount = Math.max(0, Number(total || 0))
  if (usesPackage && amount <= 0.005) {
    return { tone: 'success', label: 'Coberto pelo pacote', detail: 'Sem valor avulso pendente para este atendimento.' }
  }
  if (completed && needsPayment && amount > 0.005) {
    return { tone: 'warning', label: 'Recebimento pendente', detail: `Valor operacional: ${amount}` }
  }
  if (completed) {
    return { tone: 'success', label: 'Atendimento concluído', detail: amount > 0.005 ? `Valor operacional: ${amount}` : 'Sem valor pendente.' }
  }
  return { tone: 'neutral', label: amount > 0.005 ? 'Valor previsto' : 'Sem cobrança avulsa prevista', detail: amount > 0.005 ? `Valor operacional: ${amount}` : '' }
}
