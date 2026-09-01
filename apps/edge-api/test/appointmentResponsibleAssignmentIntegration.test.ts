import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleAppointmentResponsibleAssignmentApi } from '../src/appointmentResponsibleAssignmentApi'
import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'

const AUTH_SECRET = 'responsible-assignment-test-secret-123456789012345678901'

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

function assignRequest(cookie: string, tenantId: string, appointmentId: string, staffKey = 'esteticista-1') {
  return handleAppointmentResponsibleAssignmentApi(new Request(
    `https://edge.test/api/petshop/appointments/${appointmentId}/responsible`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-tenant-id': tenantId,
        'x-module-id': 'petshop',
      },
      body: JSON.stringify({
        responsible_staff_key: staffKey,
        responsible_staff_name: 'Luana',
      }),
    },
  ), bindings())
}

describe('appointment responsible assignment in workerd', () => {
  it('persists the responsible once and records the operational audit', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `responsible-tenant-${suffix}`
    const userId = `responsible-user-${suffix}`
    const principalId = `responsible-principal-${suffix}`
    const clientId = `responsible-client-${suffix}`
    const petId = `responsible-pet-${suffix}`
    const appointmentId = `responsible-appointment-${suffix}`
    const email = `responsible-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Responsible Assignment Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Responsible Tenant','active',?3,?3)")
        .bind(tenantId, `responsible-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Responsible Assignment Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'admin',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'admin_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Teste','active',?3,?3)")
        .bind(tenantId, clientId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Pet Teste','dog',8,'active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
      db.prepare(`INSERT INTO appointments(
        tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
        subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,60,'banho_tosa','completed','manual',2000,0,'Corte de unha',3,?6,?6)`)
        .bind(tenantId, appointmentId, clientId, petId, now - 3600000, now),
    ])

    try {
      const cookie = await signIn(email, password)
      const assigned = await assignRequest(cookie, tenantId, appointmentId)
      expect(assigned).not.toBeNull()
      expect(assigned?.status).toBe(200)
      await expect(assigned?.json()).resolves.toEqual({
        appointment: expect.objectContaining({
          id: appointmentId,
          status: 'completed',
          responsible_staff_key: 'esteticista-1',
          responsible_staff_name: 'Luana',
          version: 4,
        }),
      })

      const stored = await db.prepare(`
        SELECT responsible_staff_key,responsible_staff_name,version,notes,subtotal_cents
        FROM appointments
        WHERE tenant_id=?1 AND module_id='petshop' AND id=?2
      `).bind(tenantId, appointmentId).first<{
        responsible_staff_key: string
        responsible_staff_name: string
        version: number
        notes: string
        subtotal_cents: number
      }>()
      expect(stored).toEqual({
        responsible_staff_key: 'esteticista-1',
        responsible_staff_name: 'Luana',
        version: 4,
        notes: 'Corte de unha',
        subtotal_cents: 2000,
      })

      const duplicate = await assignRequest(cookie, tenantId, appointmentId, 'esteticista-2')
      expect(duplicate?.status).toBe(409)
      await expect(duplicate?.json()).resolves.toEqual({ code: 'APPOINTMENT_RESPONSIBLE_ALREADY_ASSIGNED' })

      const audit = await db.prepare(`
        SELECT source,title,metadata
        FROM system_update_logs
        WHERE tenant_id=?1 AND module_id='petshop'
      `).bind(tenantId).all<{ source: string; title: string; metadata: string }>()
      expect(audit.results).toHaveLength(1)
      expect(audit.results[0].source).toBe('appointment-command')
      expect(JSON.parse(audit.results[0].metadata)).toEqual(expect.objectContaining({
        event_type: 'appointment.responsible_assigned',
        appointment_id: appointmentId,
        responsible_staff_key: 'esteticista-1',
      }))
    } finally {
      await db.prepare('DELETE FROM system_update_logs WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM appointments WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM pets WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM clients WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(tenantId).run()
      await db.prepare('DELETE FROM identity_principals WHERE id=?1').bind(principalId).run()
      await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
      await authDb.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await authDb.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
