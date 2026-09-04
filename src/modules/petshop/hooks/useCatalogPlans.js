import { useCallback } from 'react'
import { DateTime } from 'luxon'

import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { todayISO } from '../../../lib/supabase'
import { normalizeCatalogPlanServices } from '../lib/catalogPlanServices'
import {
  loadPlansCommand,
  loadSubscriptionsCommand,
  savePlanCommand,
  saveSubscriptionCommand,
} from '../lib/planCommands'

const BILLING_CYCLE_DAYS = { monthly: 30, quarterly: 90 }

function addDays(value, days) {
  const date = DateTime.fromISO(String(value || ''), { zone: 'America/Sao_Paulo' })
  if (!date.isValid) return todayISO()
  return date.plus({ days }).toISODate()
}

export function useCatalogPlans() {
  const { activeTenantId } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const moduleId = activeModuleId || 'petshop'

  const loadPlans = useCallback(async () => {
    if (!activeTenantId) return []
    const rows = await loadPlansCommand({ tenantId: activeTenantId, moduleId })
    return (rows || []).map((plan) => ({
      ...plan,
      services: normalizeCatalogPlanServices(plan.services),
    }))
  }, [activeTenantId, moduleId])

  const savePlan = useCallback(async (payload = {}) => {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de salvar o plano.')
    const name = String(payload.name || '').trim()
    const services = normalizeCatalogPlanServices(payload.services)
      .filter((service) => service.qty_per_cycle > 0)

    if (!name) throw new Error('Informe o nome do plano.')
    if (!services.length) throw new Error('Adicione pelo menos um serviço real ou MotoDog ao plano.')
    const uniqueTypes = new Set(services.map((service) => service.service_type))
    if (uniqueTypes.size !== services.length) throw new Error('O mesmo serviço não pode aparecer duas vezes no plano.')

    const plan = await savePlanCommand({
      tenantId: activeTenantId,
      moduleId,
      id: payload.id,
      name,
      price: Math.max(0, Number(payload.price || 0)),
      billing_cycle: payload.billing_cycle || 'monthly',
      services,
      active: payload.active !== false,
    })
    return {
      ...plan,
      services: normalizeCatalogPlanServices(plan?.services),
    }
  }, [activeTenantId, moduleId])

  const loadSubscriptions = useCallback(async () => {
    if (!activeTenantId) return []
    const rows = await loadSubscriptionsCommand({ tenantId: activeTenantId, moduleId })
    return (rows || []).map((subscription) => ({
      ...subscription,
      subscription_plans: subscription.subscription_plans
        ? {
            ...subscription.subscription_plans,
            services: normalizeCatalogPlanServices(subscription.subscription_plans.services),
          }
        : null,
    }))
  }, [activeTenantId, moduleId])

  const saveSubscription = useCallback(async (payload = {}) => {
    if (!activeTenantId) throw new Error('Selecione uma empresa ativa antes de salvar a assinatura.')
    if (!payload.plan_id || !payload.client_id) throw new Error('Selecione o plano e o pet.')

    const isNewSubscription = !payload.id
    const requestedStatus = payload.status || 'active'
    const status = isNewSubscription && requestedStatus === 'active'
      ? 'pending_payment'
      : requestedStatus
    const startedAt = payload.started_at || todayISO()
    const cycle = payload.billing_cycle || payload.plan?.billing_cycle || 'monthly'

    const subscription = await saveSubscriptionCommand({
      tenantId: activeTenantId,
      moduleId,
      id: payload.id,
      plan_id: payload.plan_id,
      client_id: payload.client_id,
      pet_id: payload.pet_id,
      status,
      started_at: startedAt,
      first_appointment_at: payload.first_appointment_at,
      next_billing_date: payload.next_billing_date || addDays(startedAt, BILLING_CYCLE_DAYS[cycle] || 30),
      services_used: payload.services_used || {},
    })

    if (isNewSubscription && subscription?.status === 'pending_payment' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('yuisync:subscription-pending-payment', {
        detail: {
          subscriptionId: subscription.id,
          clientId: subscription.client_id,
          clientName: '',
          planName: payload.plan?.name || '',
        },
      }))
    }

    return subscription
  }, [activeTenantId, moduleId])

  return {
    loadPlans,
    savePlan,
    loadSubscriptions,
    saveSubscription,
  }
}
