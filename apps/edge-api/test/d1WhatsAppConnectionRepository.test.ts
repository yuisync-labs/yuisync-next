import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import { parseWhatsAppAccountConnectionV1 } from '../../../shared/contracts/v1/index'
import {
  D1WhatsAppConnectionRepository,
  WhatsAppConnectionRepositoryError,
} from '../src/adapters/d1WhatsAppConnectionRepository'

const testEnv = env as EdgeEnv & { DB: D1Database }
const TENANT_A = 'tenant-wa-connection-a'
const TENANT_B = 'tenant-wa-connection-b'

async function seedTenant(id: string): Promise<void> {
  const now = 1_786_966_000_000
  await testEnv.DB.prepare(`
    INSERT OR REPLACE INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
    VALUES(?1,?2,?3,'active',?4,?4)
  `).bind(id, id, id, now).run()
}

function connection(overrides: Record<string, unknown> = {}) {
  return parseWhatsAppAccountConnectionV1({
    type: 'whatsapp_account_connection',
    version: 1,
    tenant_id: TENANT_A,
    business_id: 'business-wa-a',
    waba_id: 'waba-wa-a',
    phone_number_id: '112233445566778',
    display_phone_number: '+55 32 99999-9999',
    verified_name: 'Petshop A',
    status: 'connected',
    ...overrides,
  })
}

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM whatsapp_ingress_receipts WHERE tenant_id IN (?1,?2)')
    .bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM whatsapp_phone_connections WHERE tenant_id IN (?1,?2)')
    .bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM whatsapp_waba_accounts WHERE tenant_id IN (?1,?2)')
    .bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM tenant_module_settings WHERE tenant_id IN (?1,?2)')
    .bind(TENANT_A, TENANT_B).run()
  await testEnv.DB.prepare('DELETE FROM tenants WHERE id IN (?1,?2)')
    .bind(TENANT_A, TENANT_B).run()
  await seedTenant(TENANT_A)
  await seedTenant(TENANT_B)
})

describe('D1WhatsAppConnectionRepository', () => {
  it('persiste e resolve conexão por tenant, WABA e phone_number_id', async () => {
    const repository = new D1WhatsAppConnectionRepository(testEnv.DB, () => 1_786_966_100_000)
    const expected = connection()

    await repository.save(expected)

    await expect(repository.findByPhoneNumberId(expected.phone_number_id)).resolves.toEqual(expected)
    await expect(repository.findByTenantId(TENANT_A)).resolves.toEqual([expected])
    await expect(repository.findByWabaId(expected.waba_id)).resolves.toEqual([expected])
  })

  it('permite vários números do mesmo WABA somente dentro do mesmo tenant', async () => {
    const repository = new D1WhatsAppConnectionRepository(testEnv.DB)
    const first = connection()
    const second = connection({
      phone_number_id: '112233445566779',
      display_phone_number: '+55 32 98888-8888',
      verified_name: 'Petshop A - Linha 2',
    })

    await repository.save(first)
    await repository.save(second)

    await expect(repository.findByWabaId(first.waba_id)).resolves.toEqual([first, second])
  })

  it('rejeita apropriação de WABA já pertencente a outro tenant', async () => {
    const repository = new D1WhatsAppConnectionRepository(testEnv.DB)
    await repository.save(connection())

    await expect(repository.save(connection({
      tenant_id: TENANT_B,
      phone_number_id: '998877665544332',
    }))).rejects.toMatchObject({
      name: 'WhatsAppConnectionRepositoryError',
      code: 'CONNECTION_CONFLICT',
    })
  })

  it('rejeita reassociação de phone_number_id para outro tenant ou WABA', async () => {
    const repository = new D1WhatsAppConnectionRepository(testEnv.DB)
    await repository.save(connection())

    await expect(repository.save(connection({
      tenant_id: TENANT_B,
      business_id: 'business-wa-b',
      waba_id: 'waba-wa-b',
    }))).rejects.toBeInstanceOf(WhatsAppConnectionRepositoryError)

    await expect(repository.save(connection({
      business_id: 'business-wa-a-2',
      waba_id: 'waba-wa-a-2',
    }))).rejects.toMatchObject({
      code: 'CONNECTION_CONFLICT',
    })
  })

  it('atualiza metadados públicos e status sem trocar ownership', async () => {
    const repository = new D1WhatsAppConnectionRepository(testEnv.DB)
    await repository.save(connection({ status: 'pending' }))
    const updated = connection({
      display_phone_number: '+55 32 97777-7777',
      verified_name: 'Petshop A Oficial',
      status: 'connected',
    })

    await repository.save(updated)

    await expect(repository.findByPhoneNumberId(updated.phone_number_id)).resolves.toEqual(updated)
  })

  it('falha de forma categorizada quando o binding D1 não existe', async () => {
    const repository = new D1WhatsAppConnectionRepository()

    await expect(repository.findByPhoneNumberId('112233445566778')).rejects.toMatchObject({
      code: 'DATABASE_NOT_CONFIGURED',
      message: 'WhatsApp account connection could not be persisted.',
    })
  })
})
