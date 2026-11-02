export const CAMPAIGN_SEGMENTS = [
  {
    id: 'inactive',
    label: 'Sem retornar',
    description: 'Clientes sem atendimento concluído há um período.',
  },
  {
    id: 'all',
    label: 'Todos os clientes',
    description: 'Toda a carteira elegível para receber campanhas.',
  },
  {
    id: 'recurring',
    label: 'Clientes recorrentes',
    description: 'Clientes com frequência de atendimento no período.',
  },
  {
    id: 'recurring_inactive',
    label: 'Recorrentes sem retorno',
    description: 'Clientes frequentes que deixaram de voltar.',
  },
  {
    id: 'first_visit',
    label: 'Primeira visita sem retorno',
    description: 'Clientes com um único atendimento concluído.',
  },
  {
    id: 'never_attended',
    label: 'Nunca atendidos',
    description: 'Cadastros sem atendimento concluído.',
  },
]

const text = (value, max) =>
  typeof value === 'string' ? value.slice(0, max) : ''
const integer = (value, fallback, max) =>
  Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max
    ? Number(value)
    : fallback

export function normalizeCampaignDraft(value = {}) {
  const row = value && typeof value === 'object' ? value : {}
  const message = text(row.message, 1024)
  return {
    id: text(row.id, 100),
    name: text(row.name, 100),
    segment: CAMPAIGN_SEGMENTS.some(({ id }) => id === row.segment)
      ? row.segment
      : 'inactive',
    inactiveDays: integer(row.inactiveDays, 45, 3650),
    minVisits: integer(row.minVisits, 3, 1000),
    periodMonths: integer(row.periodMonths, 6, 120),
    excludeFutureBookings: row.excludeFutureBookings !== false,
    cooldownDays: integer(row.cooldownDays, 7, 365),
    brief: text(row.brief, 2000),
    message,
    confirmedMessage:
      row.confirmedMessage === message && message.trim() ? message : '',
    button: row.button === 'booking' ? 'booking' : 'reply',
    budget: /^\d{1,7}(\.\d{1,2})?$/.test(String(row.budget ?? ''))
      ? String(row.budget)
      : '',
    sendMode: row.sendMode === 'scheduled' ? 'scheduled' : 'manual',
    scheduledAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.scheduledAt)
      ? row.scheduledAt
      : '',
    updatedAt:
      Number.isSafeInteger(row.updatedAt) && row.updatedAt >= 0
        ? row.updatedAt
        : 0,
  }
}

export function campaignStorageKey(userId, tenantId, moduleId) {
  return userId && tenantId && moduleId
    ? `@yuisync:campaign-drafts:v1:${JSON.stringify([userId, tenantId, moduleId])}`
    : null
}

export function readCampaignDrafts(storage, key) {
  if (!key) return []
  const raw = storage.getItem(key)
  if (!raw) return []
  const value = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('Invalid campaign drafts')
  return value
    .slice(0, 50)
    .filter((row) => row && typeof row.id === 'string' && row.id.length > 0)
    .map(normalizeCampaignDraft)
}

export function audienceDescription(draft) {
  return {
    inactive: `Sem atendimento concluído há mais de ${draft.inactiveDays} dias`,
    all: 'Todos os clientes elegíveis',
    recurring: `Pelo menos ${draft.minVisits} atendimentos concluídos nos últimos ${draft.periodMonths} meses`,
    recurring_inactive: `Pelo menos ${draft.minVisits} atendimentos nos últimos ${draft.periodMonths} meses e sem retorno há mais de ${draft.inactiveDays} dias`,
    first_visit: `Um único atendimento concluído, há mais de ${draft.inactiveDays} dias`,
    never_attended: 'Nenhum atendimento concluído',
  }[draft.segment]
}

export function previewCampaignMessage(message, storeName = 'Sua loja') {
  const samples = {
    nome_tutor: 'Marina',
    nome_pet: 'Luna',
    nome_loja: storeName,
  }
  return message.replace(
    /\{\{\s*(nome_tutor|nome_pet|nome_loja)\s*\}\}/g,
    (_, key) => samples[key],
  )
}

export function unknownCampaignVariables(message) {
  return [...message.matchAll(/\{\{(.*?)\}\}/g)]
    .map((match) => match[1].trim())
    .filter((name) => !['nome_tutor', 'nome_pet', 'nome_loja'].includes(name))
}
