import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleAppointmentFinancialReopenApi } from '../src/appointmentFinancialReopenApi'
import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'

const AUTH_SECRET = 'financial-reopen-test-secret-123456789012345678901'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
    DB: (env as EdgeEnv & { DB: D1Database }).DB,
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://edge.test' },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())
  expect(response).not.toBeNull()
  expect(response?.status).toBe(200)
  return response?.headers.get('set-cookie')?.split(';')[0] || ''
}

async function reopenFinancial(
  cookie: string,
  tenantId: string,
  appointmentId: string,
): Promise<Response> {
  const response = await handleAppointmentFinancialReopenApi(new Request(
    `https://edge.test/api/petshop/appointments/${appointmentId}/financial-reopen`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-tenant-id': tenantId,
        'x-module-id': 'petshop',
      },
      body: JSON.stringify({ status: 'scheduled', financial_action: 'refund' }),
    },
  ), bindings())
  expect(response).not.toBeNull()
  return response as Response
}

describe('appointment financial reopen integrity in workerd', () => {
  it('commits internal reversal with reopen atomically and refuses fictitious provider refunds', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `financial-reopen-tenant-${suffix}`
    const userId = `financial-reopen-user-${suffix}`
    const principalId = `financial-reopen-principal-${suffix}`
    const clientId = `financial-reopen-client-${suffix}`
    const petId = `financial-reopen-pet-${suffix}`
    const internalAppointmentId = `financial-reopen-internal-${suffix}`
    const externalAppointmentId = `financial-reopen-external-${suffix}`
    const internalSaleId = `financial-reopen-internal-sale-${suffix}`
    const externalSaleId = `financial-reopen-external-sale-${suffix}`
    const internalPaymentId = `financial-reopen-internal-payment-${suffix}`
    const externalPaymentId = `financial-reopen-external-payment-${suffix}`
    const email = `financial-reopen-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const scheduledAt = Date.parse('2026-08-20T13:00:00.000Z')

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Financial Reopen Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Financial Reopen Tenant','active',?3,?3)")
        .bind(tenantId, `financial-reopen-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Financial Reopen Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'admin',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'admin_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Financeiro','active',?3,?3)")
        .bind(tenantId, clientId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Pet Financeiro','dog',8,'active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
      db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',5500,0,NULL,1,?6,?6)`)
        .bind(tenantId, internalAppointmentId, clientId, petId, scheduledAt, now),
      db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',5500,0,NULL,1,?6,?6)`)
        .bind(tenantId, externalAppointmentId, clientId, petId, scheduledAt + 3600000, now),
      db.prepare(`INSERT INTO sales(
        tenant_id,module_id,id,operation_key,client_id,appointment_id,source,fulfillment_type,
        subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms,
        origin_type,origin_id
      ) VALUES(?1,'petshop',?2,?3,?4,?5,'pos','service',5500,0,0,5500,'completed',NULL,?6,?6,'appointment',?5)`)
        .bind(tenantId, internalSaleId, `financial-reopen-internal-sale-op-${suffix}`, clientId, internalAppointmentId, now),
      db.prepare(`INSERT INTO sales(
        tenant_id,module_id,id,operation_key,client_id,appointment_id,source,fulfillment_type,
        subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,notes,created_at_ms,updated_at_ms,
        origin_type,origin_id
      ) VALUES(?1,'petshop',?2,?3,?4,?5,'pos','service',5500,0,0,5500,'completed',NULL,?6,?6,'appointment',?5)`)
        .bind(tenantId, externalSaleId, `financial-reopen-external-sale-op-${suffix}`, clientId, externalAppointmentId, now),
      db.prepare(`INSERT INTO payments(
        tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,provider,provider_reference,
        received_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,'pix',5500,'received',NULL,NULL,?5,?5,?5)`)
        .bind(tenantId, internalPaymentId, internalSaleId, `financial-reopen-internal-payment-op-${suffix}`, now),
      db.prepare(`INSERT INTO payments(
        tenant_id,module_id,id,sale_id,operation_key,method,amount_cents,status,provider,provider_reference,
        received_at_ms,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,'card',5500,'received','external-provider',?5,?6,?6,?6)`)
        .bind(tenantId, externalPaymentId, externalSaleId, `financial-reopen-external-payment-op-${suffix}`, `provider-ref-${suffix}`, now),
    ])

    try {
      const cookie = await signIn(email, password)

      const internal = await reopenFinancial(cookie, tenantId, internalAppointmentId)
      expect(internal.status).toBe(200)
      await expect(internal.json()).resolves.toEqual(expect.objectContaining({
        data: expect.objectContaining({
          appointment_id: internalAppointmentId,
          status: 'scheduled',
          reopened: true,
          financial: expect.objectContaining({
            action: 'refund',
            sale_id: internalSaleId,
            status: 'refunded',
          }),
        }),
      }))

      const internalState = await db.prepare(`SELECT
        (SELECT status FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND id=?2) AS appointment_status,
        (SELECT status FROM sales WHERE tenant_id=?1 AND module_id='petshop' AND id=?3) AS sale_status,
        (SELECT status FROM payments WHERE tenant_id=?1 AND module_id='petshop' AND id=?4) AS payment_status,
        (SELECT status FROM financial_effects WHERE tenant_id=?1 AND module_id='petshop' AND operation_key=?5) AS effect_status
      `).bind(
        tenantId,
        internalAppointmentId,
        internalSaleId,
        internalPaymentId,
        `appointment-reopen:${internalAppointmentId}:refund:${internalSaleId}`,
      ).first<{ appointment_status:string; sale_status:string; payment_status:string; effect_status:string }>()
      expect(internalState).toEqual({
        appointment_status: 'scheduled',
        sale_status: 'refunded',
        payment_status: 'refunded',
        effect_status: 'completed',
      })

      const external = await reopenFinancial(cookie, tenantId, externalAppointmentId)
      expect(external.status).toBe(409)
      await expect(external.json()).resolves.toEqual(expect.objectContaining({
        code: 'APPOINTMENT_REOPEN_EXTERNAL_REFUND_REQUIRED',
        sale_id: externalSaleId,
        payment_ids: [externalPaymentId],
      }))

      const externalState = await db.prepare(`SELECT
        (SELECT status FROM appointments WHERE tenant_id=?1 AND module_id='petshop' AND id=?2) AS appointment_status,
        (SELECT status FROM sales WHERE tenant_id=?1 AND module_id='petshop' AND id=?3) AS sale_status,
        (SELECT status FROM payments WHERE tenant_id=?1 AND module_id='petshop' AND id=?4) AS payment_status,
        (SELECT count(*) FROM financial_effects WHERE tenant_id=?1 AND module_id='petshop' AND aggregate_id=?3 AND effect_type='refund') AS refund_effects
      `).bind(tenantId, externalAppointmentId, externalSaleId, externalPaymentId)
        .first<{ appointment_status:string; sale_status:string; payment_status:string; refund_effects:number }>()
      expect(externalState).toEqual({
        appointment_status: 'completed',
        sale_status: 'completed',
        payment_status: 'received',
        refund_effects: 0,
      })
    } finally {
      await db.prepare("DELETE FROM system_update_logs WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM financial_effects WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM payment_splits WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM payments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM sale_items WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM sales WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_transport WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM pets WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM clients WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
      await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
