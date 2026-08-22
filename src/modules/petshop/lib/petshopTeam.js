import {
  Bike,
  Briefcase,
  Droplets,
  PawPrint,
  Scissors,
  ShieldCheck,
  ShoppingCart,
  Stethoscope,
  Syringe,
  User,
} from 'lucide-react'

export const STAFF_TYPE_OPTIONS = [
  { value: 'funcionario', label: 'Funcionario', description: 'Operacao geral' },
  { value: 'banho_tosa', label: 'Banho/Tosa', description: 'Profissional de banho, tosa e acabamento' },
  { value: 'veterinaria', label: 'Veterinaria', description: 'Atendimento clinico e vacinas' },
  { value: 'motodog', label: 'Motoboy', description: 'Transporte e entregas' },
  { value: 'vendedor_caixa', label: 'Vendedor/Caixa', description: 'PDV e vendas de balcao' },
  { value: 'gerente', label: 'Gerente', description: 'Gestao operacional' },
]

// O catalogo de servicos deve vir exclusivamente dos registros reais do tenant.
// Manter esta exportacao vazia preserva compatibilidade com imports antigos sem
// voltar a exibir servicos sinteticos como "Banho", "Tosa" ou "Escovacao".
export const DEFAULT_PETSHOP_SERVICES = []

export const SERVICE_GROUPS = [
  { id: 'banho_tosa', label: 'Banho/Tosa', icon: Scissors },
  { id: 'veterinaria', label: 'Veterinaria', icon: Stethoscope },
  { id: 'motoboy', label: 'Motoboy', icon: Bike },
  { id: 'outro', label: 'Outros', icon: PawPrint },
]

export const COMMISSION_SCOPES = [
  { value: 'all', label: 'Tudo' },
  { value: 'service', label: 'Servico especifico' },
  { value: 'services', label: 'Servicos gerais' },
  { value: 'sale', label: 'Venda geral' },
  { value: 'category', label: 'Categoria de produto' },
  { value: 'product', label: 'Produto especifico' },
  { value: 'motoboy', label: 'Motoboy/transporte' },
]

const ICONS = {
  bike: Bike,
  briefcase: Briefcase,
  droplets: Droplets,
  paw: PawPrint,
  scissors: Scissors,
  shield: ShieldCheck,
  shopping: ShoppingCart,
  stethoscope: Stethoscope,
  syringe: Syringe,
  user: User,
}

export function normalizeCode(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function normalizeService(row = {}) {
  const explicitCode = String(row.code || '').trim()
  const code = explicitCode || normalizeCode(row.service_type || row.name)
  const normalizedCode = normalizeCode(code)
  const fallback = DEFAULT_PETSHOP_SERVICES.find((item) => normalizeCode(item.code) === normalizedCode)
  return {
    ...row,
    id: row.id || code,
    code,
    name: row.name || fallback?.name || code || 'Servico',
    group_type: row.group_type || fallback?.group_type || getServiceGroupFromCode(code),
    default_price: Number(row.default_price ?? row.price ?? fallback?.default_price ?? 0),
    default_duration_min: Number(row.default_duration_min ?? row.duration_min ?? fallback?.default_duration_min ?? 60),
    commission_type: row.commission_type || fallback?.commission_type || 'percentage',
    commission_rate: Number(row.commission_rate ?? fallback?.commission_rate ?? 0),
    active: row.active !== false,
    sort_order: Number(row.sort_order ?? fallback?.sort_order ?? 999),
    icon: row.icon || fallback?.icon || 'paw',
  }
}

export function normalizeServices(rows = []) {
  const source = Array.isArray(rows) ? rows : []
  const byCode = new Map()
  source.map(normalizeService).forEach((service) => byCode.set(service.code, service))
  return [...byCode.values()].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
}

export function activeServices(rows = []) {
  return normalizeServices(rows).filter((service) => service.active)
}

export function getServiceGroupFromCode(type = '') {
  const service = normalizeCode(type)
  if (/vet|veterin|consulta|vacina|clinica|medico|exame|cirurg|ultrassom|castr|curativo|hemograma|radiograf|raio_x|odontolog/.test(service)) return 'veterinaria'
  if (/banho|tosa|tosagem|tosar|trim|trimming|stripping|acabamento|penteado|desembolo|desembarac|escovac|hidrat|higien|groom|unha|ouvido|orelha/.test(service)) return 'banho_tosa'
  if (/moto|entrega|transporte|retirada|busca/.test(service)) return 'motoboy'
  return 'outro'
}

export function serviceOptionsForGroup(services = [], group = 'banho_tosa') {
  const options = activeServices(services)
  return options.filter((service) => service.group_type === group)
}

export function findService(services = [], code = '') {
  const requested = String(code || '').trim()
  const normalized = normalizeCode(requested)
  return normalizeServices(services).find((service) => (
    service.code === requested
    || normalizeCode(service.code) === normalized
    || normalizeCode(service.name) === normalized
  )) || normalizeService({ code: requested || normalized || 'outro' })
}

export function serviceLabel(services = [], code = '') {
  return findService(services, code).name
}

export function serviceIcon(serviceOrIcon) {
  if (serviceOrIcon && typeof serviceOrIcon === 'object') {
    const text = normalizeCode([
      serviceOrIcon.name,
      serviceOrIcon.label,
      serviceOrIcon.code,
      serviceOrIcon.value,
      serviceOrIcon.category,
      serviceOrIcon.description,
    ].filter(Boolean).join(' '))
    if (/tosa|tosagem|tosar|trim|trimming|stripping|acabamento|penteado/.test(text)) return Scissors
    if (/banho|lavagem|secagem/.test(text)) return Droplets
    if (/vet|veterin|consulta|vacina|clinica|medico|exame|cirurg/.test(text)) return Stethoscope
  }
  const key = typeof serviceOrIcon === 'string' ? serviceOrIcon : serviceOrIcon?.icon
  return ICONS[key] || PawPrint
}

export function staffTypeLabel(value) {
  return STAFF_TYPE_OPTIONS.find((item) => item.value === value)?.label || 'Funcionario'
}

export function commissionScopeLabel(value) {
  return COMMISSION_SCOPES.find((item) => item.value === value)?.label || value || 'Tudo'
}
