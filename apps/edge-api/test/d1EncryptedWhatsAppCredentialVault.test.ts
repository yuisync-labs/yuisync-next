import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'

import { parseWhatsAppAccountConnectionV1 } from '../../../shared/contracts/v1/index'
import { D1EncryptedWhatsAppCredentialVault } from '../src/adapters/d1EncryptedWhatsAppCredentialVault'
import { D1WhatsAppConnectionRepository } from '../src/adapters/d1WhatsAppConnectionRepository'

const testEnv = env as EdgeEnv & { DB: D1Database }
const TENANT = 'tenant-wa-vault'
const PHONE = '551199999999999'
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM whatsapp_access_credentials WHERE tenant_id=?1').bind(TENANT).run()
  await testEnv.DB.prepare('DELETE FROM whatsapp_phone_connections WHERE tenant_id=?1').bind(TENANT).run()
  await testEnv.DB.prepare('DELETE FROM whatsapp_waba_accounts WHERE tenant_id=?1').bind(TENANT).run()
  await testEnv.DB.prepare('DELETE FROM tenants WHERE id=?1').bind(TENANT).run()
  await testEnv.DB.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,?1,'active',1,1)`).bind(TENANT).run()
  await new D1WhatsAppConnectionRepository(testEnv.DB).save(parseWhatsAppAccountConnectionV1({
    type: 'whatsapp_account_connection',
    version: 1,
    tenant_id: TENANT,
    business_id: '111111111111111',
    waba_id: '222222222222222',
    phone_number_id: PHONE,
    status: 'pending',
  }))
})

describe('D1EncryptedWhatsAppCredentialVault', () => {
  it('faz round-trip AES-GCM sem persistir o token em texto puro', async () => {
    const token = 'EAA-secret-meta-token-never-plaintext'
    const vault = new D1EncryptedWhatsAppCredentialVault(testEnv.DB, KEY, () => 1_786_966_200_000)
    await vault.save({ tenantId: TENANT, phoneNumberId: PHONE, accessToken: token })

    await expect(vault.findByPhoneNumberId(TENANT, PHONE)).resolves.toEqual({
      tenantId: TENANT,
      phoneNumberId: PHONE,
      accessToken: token,
    })

    const row = await testEnv.DB.prepare(`SELECT token_ciphertext,token_iv,key_version FROM whatsapp_access_credentials WHERE tenant_id=?1 AND phone_number_id=?2`).bind(TENANT, PHONE).first<{ token_ciphertext: string; token_iv: string; key_version: number }>()
    expect(row?.token_ciphertext).not.toContain(token)
    expect(row?.token_iv).not.toBe('')
    expect(row?.key_version).toBe(1)
  })

  it('falha fechado com chave fora do formato AES-256 configurado', () => {
    expect(() => new D1EncryptedWhatsAppCredentialVault(testEnv.DB, 'short-key')).toThrowError(expect.objectContaining({
      code: 'WHATSAPP_CREDENTIAL_VAULT_INVALID_KEY',
    }))
  })
})
