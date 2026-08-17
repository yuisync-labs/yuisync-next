import type {
  WhatsAppAccessCredential,
  WhatsAppCredentialVaultPort,
} from '../../../../server/application/ports/whatsapp'

const KEY_BYTES = 32
const IV_BYTES = 12
const KEY_VERSION = 1

type CredentialRow = Readonly<{
  token_ciphertext: string
  token_iv: string
  key_version: number
}>

export type WhatsAppCredentialVaultErrorCode =
  | 'WHATSAPP_CREDENTIAL_VAULT_NOT_CONFIGURED'
  | 'WHATSAPP_CREDENTIAL_VAULT_INVALID_KEY'
  | 'WHATSAPP_CREDENTIAL_VAULT_UNAVAILABLE'
  | 'WHATSAPP_CREDENTIAL_VAULT_CORRUPT'

export class WhatsAppCredentialVaultError extends Error {
  readonly code: WhatsAppCredentialVaultErrorCode

  constructor(code: WhatsAppCredentialVaultErrorCode) {
    super('WhatsApp credential vault operation failed.')
    this.name = 'WhatsAppCredentialVaultError'
    this.code = code
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function decodeHexKey(value: string): Uint8Array {
  const normalized = clean(value)
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_INVALID_KEY')
  }
  const result = new Uint8Array(KEY_BYTES)
  for (let index = 0; index < KEY_BYTES; index += 1) {
    result[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_CORRUPT')
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function aad(tenantId: string, phoneNumberId: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(`${tenantId}:${phoneNumberId}:v${KEY_VERSION}`))
}

export class D1EncryptedWhatsAppCredentialVault implements WhatsAppCredentialVaultPort {
  private readonly database?: D1Database
  private readonly keyBytes: Uint8Array
  private readonly now: () => number

  constructor(database: D1Database | undefined, encryptionKeyHex: string | undefined, now: () => number = Date.now) {
    this.database = database
    this.keyBytes = decodeHexKey(encryptionKeyHex ?? '')
    this.now = now
  }

  async save(credential: WhatsAppAccessCredential): Promise<void> {
    const database = this.requireDatabase()
    const tenantId = clean(credential.tenantId)
    const phoneNumberId = clean(credential.phoneNumberId)
    const accessToken = clean(credential.accessToken)
    if (!tenantId || !phoneNumberId || !accessToken) {
      throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_UNAVAILABLE')
    }

    try {
      const key = await this.cryptoKey()
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      const plaintext = new TextEncoder().encode(accessToken)
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(iv),
          additionalData: aad(tenantId, phoneNumberId),
          tagLength: 128,
        },
        key,
        toArrayBuffer(plaintext),
      )
      const now = this.now()
      await database.prepare(`
        INSERT INTO whatsapp_access_credentials(
          tenant_id,phone_number_id,token_ciphertext,token_iv,key_version,created_at_ms,updated_at_ms
        ) VALUES(?1,?2,?3,?4,?5,?6,?6)
        ON CONFLICT(tenant_id,phone_number_id) DO UPDATE SET
          token_ciphertext=excluded.token_ciphertext,
          token_iv=excluded.token_iv,
          key_version=excluded.key_version,
          updated_at_ms=excluded.updated_at_ms
      `).bind(
        tenantId,
        phoneNumberId,
        toBase64(new Uint8Array(encrypted)),
        toBase64(iv),
        KEY_VERSION,
        now,
      ).run()
    } catch (error) {
      if (error instanceof WhatsAppCredentialVaultError) throw error
      throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_UNAVAILABLE')
    }
  }

  async findByPhoneNumberId(tenantIdInput: string, phoneNumberIdInput: string): Promise<WhatsAppAccessCredential | null> {
    const database = this.requireDatabase()
    const tenantId = clean(tenantIdInput)
    const phoneNumberId = clean(phoneNumberIdInput)
    if (!tenantId || !phoneNumberId) return null

    let row: CredentialRow | null
    try {
      row = await database.prepare(`
        SELECT token_ciphertext,token_iv,key_version
        FROM whatsapp_access_credentials
        WHERE tenant_id=?1 AND phone_number_id=?2
        LIMIT 1
      `).bind(tenantId, phoneNumberId).first<CredentialRow>()
    } catch {
      throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_UNAVAILABLE')
    }
    if (!row) return null
    if (row.key_version !== KEY_VERSION) {
      throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_CORRUPT')
    }

    try {
      const key = await this.cryptoKey()
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(fromBase64(row.token_iv)),
          additionalData: aad(tenantId, phoneNumberId),
          tagLength: 128,
        },
        key,
        toArrayBuffer(fromBase64(row.token_ciphertext)),
      )
      const accessToken = new TextDecoder().decode(decrypted).trim()
      if (!accessToken) throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_CORRUPT')
      return { tenantId, phoneNumberId, accessToken }
    } catch (error) {
      if (error instanceof WhatsAppCredentialVaultError) throw error
      throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_CORRUPT')
    }
  }

  private requireDatabase(): D1Database {
    if (!this.database) {
      throw new WhatsAppCredentialVaultError('WHATSAPP_CREDENTIAL_VAULT_NOT_CONFIGURED')
    }
    return this.database
  }

  private async cryptoKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', toArrayBuffer(this.keyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
}
