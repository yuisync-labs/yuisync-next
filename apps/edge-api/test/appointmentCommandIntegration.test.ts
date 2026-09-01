import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'
import { handleCompatApiRequest } from '../src/compatApi'
import { handlePetshopAppointmentsApiRequest } from '../src/petshopAppointmentsApi'

const AUTH_SECRET = 'appointment-command-test-secret-123456789012345678901'

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
    headers: {
      'content-type': 'application/json',
      origin: 'https://edge.test',
    },
    body: JSON.stringify({ email, password, rememberMe: false }),
  }), bindings())

  expect(response).not.toBeNull()
  expect(response?.status).toBe(200)
  const cookie = response?.headers.get('set-cookie')?.split(';')[0] || ''
  expect(cookie).toContain('better-auth')
  return cookie
}

async function book(
  cookie: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const response = await handleCompatApiRequest(new Request('https://edge.test/api/compat/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-tenant-id': tenantId,
      'x-module-id': 'petshop',
    },
    body: JSON.stringify({
      name: 'book_petshop_appointment_transaction',
      args: { p_payload: payload },
    }),
  }), bindings())
  expect(response).not.toBeNull()
  return response as Response
}

describe('appointment command policy in workerd', () => {
  it('replays the same operation, rejects key reuse and allows identical bookings with a new key', async () => {
    const authDb = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const db = (env as EdgeEnv & { DB: D1Database }).DB
    const suffix = crypto.randomUUID()
    const tenantId = `tenant-appointment-${suffix}`
    const userId = `appointment-user-${suffix}`
    const principalId = `appointment-principal-${suffix}`
    const clientId = `appointment-client-${suffix}`
    const petId = `appointment-pet-${suffix}`
    const serviceId = `appointment-service-${suffix}`
    const serviceCode = `bath-small-${suffix}`
    const email = `appointment-${suffix}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await authDb.batch([
      authDb.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'Appointment Command Test', email, nowIso),
      authDb.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    await db.batch([
      db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?2,'Appointment Tenant','active',?3,?3)")
        .bind(tenantId, `appointment-${suffix}`, now),
      db.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?2,'Appointment Command Test',?3,'active',?4,?4)")
        .bind(principalId, userId, email, now),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(?1,?2,'active',?3,?3,'staff',?4)")
        .bind(tenantId, principalId, now, JSON.stringify({ petshop: { role: 'funcionario_pet' } })),
      db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Tutor Teste','active',?3,?3)")
        .bind(tenantId, clientId, now),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,'Mel','dog',8,'active',?4,?4)")
        .bind(tenantId, petId, clientId, now),
      db.prepare(`INSERT INTO services(
        tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,
        commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,
        min_weight_kg,max_weight_kg,species_target
      ) VALUES(?1,'petshop',?2,?3,'Banho pequeno','banho_tosa',5500,60,'percentage',750,1,'active',?4,?4,0,10,'dog')`)
        .bind(tenantId, serviceId, serviceCode, now),
    ])

    try {
      const cookie = await signIn(email, password)
      const idempotencyKey = `booking-${suffix}`
      const basePayload = {
        tenant_id: tenantId,
        module_id: 'petshop',
        client_id: clientId,
        pet_id: petId,
        service_type: serviceCode,
        services: [{ code: serviceCode }],
        service_group: 'banho_tosa',
        scheduled_at: '2026-08-20T13:00:00.000Z',
        duration_min: 60,
        price: 55,
        status: 'agendado',
        source: 'manual',
        transport_mode: 'cliente_leva',
        idempotency_key: idempotencyKey,
      }

      const first = await book(cookie, tenantId, basePayload)
      const firstBody = await first.json<{ data: { appointment_id: string; idempotent: boolean } }>()
      expect(first.status).toBe(200)
      expect(firstBody.data.idempotent).toBe(false)
      expect(firstBody.data.appointment_id).toBeTruthy()

      const nativeRead = await handlePetshopAppointmentsApiRequest(new Request(
        'https://edge.test/api/petshop/appointments?start=2026-08-20T00%3A00%3A00-03%3A00&end=2026-08-20T23%3A59%3A59-03%3A00',
        {
          headers: {
            cookie,
            'x-tenant-id': tenantId,
            'x-module-id': 'petshop',
          },
        },
      ), bindings())
      expect(nativeRead?.status).toBe(200)
      await expect(nativeRead?.json()).resolves.toEqual({
        appointments: [expect.objectContaining({
          id: firstBody.data.appointment_id,
          client_id: clientId,
          pet_id: petId,
          scheduled_at: '2026-08-20T13:00:00.000Z',
          service_type: serviceCode,
          status: 'agendado',
          pets: expect.objectContaining({
            id: petId,
            client_id: clientId,
            owner_name: 'Tutor Teste',
            pet_name: 'Mel',
          }),
        })],
      })

      const replay = await book(cookie, tenantId, basePayload)
      const replayBody = await replay.json<{ data: { appointment_id: string; idempotent: boolean } }>()
      expect(replay.status).toBe(200)
      expect(replayBody.data.idempotent).toBe(true)
      expect(replayBody.data.appointment_id).toBe(firstBody.data.appointment_id)

      const reusedKey = await book(cookie, tenantId, {
        ...basePayload,
        scheduled_at: '2026-08-20T14:00:00.000Z',
      })
      expect(reusedKey.status).toBe(409)
      await expect(reusedKey.json()).resolves.toEqual(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }))

      const updatedScheduledAt = '2026-08-20T15:30:00.000Z'
      const update = await handlePetshopAppointmentsApiRequest(new Request(
        `https://edge.test/api/petshop/appointments/${encodeURIComponent(firstBody.data.appointment_id)}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            cookie,
            'x-tenant-id': tenantId,
            'x-module-id': 'petshop',
          },
          body: JSON.stringify({
            ...basePayload,
            scheduled_at: updatedScheduledAt,
            notes: 'Horario alterado pelo cliente',
          }),
        },
      ), bindings())
      expect(update?.status).toBe(200)
      await expect(update?.json()).resolves.toEqual({
        appointment: expect.objectContaining({
          id: firstBody.data.appointment_id,
          scheduled_at: updatedScheduledAt,
          notes: 'Horario alterado pelo cliente',
        }),
      })

      const machineUpdate = await handleCompatApiRequest(new Request('https://edge.test/api/compat/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          'x-tenant-id': tenantId,
          'x-module-id': 'petshop',
        },
        body: JSON.stringify({
          table: 'appointments',
          action: 'update',
          payload: { grooming_machine_no: 7 },
          filters: [{ op: 'eq', column: 'id', value: firstBody.data.appointment_id }],
          mode: 'single',
        }),
      }), bindings())
      expect(machineUpdate?.status).toBe(200)
      await expect(machineUpdate?.json()).resolves.toEqual({
        data: expect.objectContaining({
          id: firstBody.data.appointment_id,
          scheduled_at: '2026-08-20 15:30:00',
          grooming_machine_no: 7,
        }),
        count: 1,
      })

      const second = await handlePetshopAppointmentsApiRequest(new Request('https://edge.test/api/petshop/appointments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          'x-tenant-id': tenantId,
          'x-module-id': 'petshop',
        },
        body: JSON.stringify({
          ...basePayload,
          client_id: petId,
          pet_id: petId,
          idempotency_key: `booking-second-${suffix}`,
        }),
      }), bindings())
      const secondBody = await second?.json<{ appointment: { id: string; client_id: string; pet_id: string } }>()
      expect(second?.status).toBe(200)
      expect(secondBody?.appointment.id).not.toBe(firstBody.data.appointment_id)
      expect(secondBody?.appointment).toEqual(expect.objectContaining({ client_id: clientId, pet_id: petId }))

      const appointments = await db.prepare("SELECT id,operation_key,operation_fingerprint,scheduled_at_ms,grooming_machine_no FROM appointments WHERE tenant_id=?1 AND module_id='petshop' ORDER BY id")
        .bind(tenantId).all<{ id:string; operation_key:string; operation_fingerprint:string; scheduled_at_ms:number; grooming_machine_no:number|null }>()
      expect(appointments.results).toHaveLength(2)
      expect(new Set(appointments.results.map((row) => row.operation_key)).size).toBe(2)
      expect(appointments.results.every((row) => row.operation_fingerprint?.length === 64)).toBe(true)
      expect(appointments.results).toContainEqual(expect.objectContaining({
        id: firstBody.data.appointment_id,
        scheduled_at_ms: Date.parse(updatedScheduledAt),
        grooming_machine_no: 7,
      }))

      const snapshots = await db.prepare(`SELECT catalog_price_cents,commission_basis_points,min_weight_kg,max_weight_kg,species_target
        FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop' ORDER BY appointment_id,position`)
        .bind(tenantId).all<{
          catalog_price_cents:number
          commission_basis_points:number
          min_weight_kg:number
          max_weight_kg:number
          species_target:string
        }>()
      expect(snapshots.results).toHaveLength(2)
      for (const snapshot of snapshots.results) {
        expect(snapshot).toEqual(expect.objectContaining({
          catalog_price_cents: 5500,
          commission_basis_points: 750,
          min_weight_kg: 0,
          max_weight_kg: 10,
          species_target: 'dog',
        }))
      }

      const registry = await db.prepare("SELECT status FROM appointment_command_registry WHERE tenant_id=?1 AND module_id='petshop'")
        .bind(tenantId).all<{ status:string }>()
      expect(registry.results).toHaveLength(2)
      expect(registry.results.every((row) => row.status === 'completed')).toBe(true)
    } finally {
      await db.prepare("DELETE FROM appointment_services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_transport WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointments WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM appointment_command_registry WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
      await db.prepare("DELETE FROM services WHERE tenant_id=?1 AND module_id='petshop'").bind(tenantId).run()
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
