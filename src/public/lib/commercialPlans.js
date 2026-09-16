export const BILLING_CYCLES = Object.freeze({
  monthly: Object.freeze({ id: 'monthly', label: 'Mensal', suffix: '/mês' }),
  yearly: Object.freeze({ id: 'yearly', label: 'Anual', suffix: '/ano' }),
})

export const COMMERCIAL_PLANS = Object.freeze([
  Object.freeze({
    id: 'start',
    platformPlanId: 'yui_start',
    name: 'Yui Start',
    eyebrow: 'Base operacional',
    subtitle: 'O essencial para organizar a rotina desde o primeiro dia.',
    monthlyCents: 19_700,
    yearlyCents: 197_000,
    staffLimit: '1 acesso de equipe',
    recommendedFor: 'Autônomos e operações em implantação',
    features: Object.freeze([
      'Agenda, clientes e pets',
      'PDV, estoque e caixa',
      'Relatórios operacionais',
      'Sessão individual de implantação (até 60 min)',
    ]),
  }),
  Object.freeze({
    id: 'pro',
    platformPlanId: 'yui_pro',
    name: 'Yui Pro',
    eyebrow: 'Operação conectada',
    subtitle: 'Mais controle para equipes que já atendem todos os dias.',
    monthlyCents: 34_700,
    yearlyCents: 347_000,
    staffLimit: 'Até 3 acessos de equipe',
    recommendedFor: 'Petshops com operação recorrente',
    highlighted: true,
    badge: 'Mais escolhido',
    features: Object.freeze([
      'Tudo do Yui Start',
      'Ordens de serviço e entregas',
      'Atendimento integrado',
      'Regras operacionais por empresa',
    ]),
  }),
  Object.freeze({
    id: 'prime',
    platformPlanId: 'yui_prime_ia',
    name: 'Yui Prime IA',
    eyebrow: 'Escala assistida',
    subtitle: 'Automação e inteligência para crescer com acompanhamento.',
    monthlyCents: 59_700,
    yearlyCents: 597_000,
    staffLimit: 'Até 5 acessos de equipe',
    recommendedFor: 'Operações que querem ganhar escala',
    badge: 'IA incluída',
    features: Object.freeze([
      'Tudo do Yui Pro',
      'Fluxos com IA assistida',
      'Campanhas e reengajamento',
      'Suporte prioritário',
    ]),
  }),
  Object.freeze({
    id: 'elite',
    platformPlanId: 'yui_elite',
    name: 'Yui Elite',
    eyebrow: 'Operação sob medida',
    subtitle: 'Implantação personalizada para cenários mais complexos.',
    monthlyCents: null,
    yearlyCents: null,
    staffLimit: 'Equipe configurável',
    recommendedFor: 'Múltiplas unidades e fluxos específicos',
    custom: true,
    badge: 'Concierge',
    features: Object.freeze([
      'Tudo do Yui Prime IA',
      'Automações específicas',
      'Especialista dedicado',
      'SLA e canal prioritários',
    ]),
  }),
])

export function commercialPlan(planId) {
  return COMMERCIAL_PLANS.find((plan) => plan.id === planId) || COMMERCIAL_PLANS[0]
}

export function planPriceCents(plan, cycle = 'monthly') {
  return cycle === 'yearly' ? plan.yearlyCents : plan.monthlyCents
}

export function formatPlanPrice(cents) {
  if (cents == null) return 'Sob consulta'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
