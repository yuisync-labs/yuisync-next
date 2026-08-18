import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

export class MigrationSecretVaultError extends Error {
  constructor(code, message = 'Migration secret vault operation failed.') {
    super(message)
    this.name = 'MigrationSecretVaultError'
    this.code = code
  }
}

export function parseMigrationVaultKey(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new MigrationSecretVaultError('MIGRATION_VAULT_KEY_REQUIRED')
  let key
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new MigrationSecretVaultError('MIGRATION_VAULT_KEY_INVALID')
  }
  if (key.length !== 32 || key.toString('base64').replace(/=+$/u, '') !== raw.replace(/=+$/u, '')) {
    throw new MigrationSecretVaultError('MIGRATION_VAULT_KEY_INVALID')
  }
  return key
}

function aad(context) {
  const runId = String(context?.runId || '').trim()
  const sourceTable = String(context?.sourceTable || '').trim()
  const sourceKey = String(context?.sourceKey || '').trim()
  const secretPath = String(context?.secretPath || '').trim()
  if (!runId || !sourceTable || !sourceKey || !secretPath) {
    throw new MigrationSecretVaultError('MIGRATION_SECRET_CONTEXT_INVALID')
  }
  return Buffer.from(`${runId}\u001f${sourceTable}\u001f${sourceKey}\u001f${secretPath}`, 'utf8')
}

export function sealMigrationSecret(secretValue, context, keyInput, { keyVersion = 1, iv = randomBytes(12) } = {}) {
  const secret = String(secretValue ?? '')
  if (!secret) throw new MigrationSecretVaultError('MIGRATION_SECRET_EMPTY')
  const key = Buffer.isBuffer(keyInput) ? keyInput : parseMigrationVaultKey(keyInput)
  if (key.length !== 32) throw new MigrationSecretVaultError('MIGRATION_VAULT_KEY_INVALID')
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new MigrationSecretVaultError('MIGRATION_KEY_VERSION_INVALID')
  if (!Buffer.isBuffer(iv) || iv.length !== 12) throw new MigrationSecretVaultError('MIGRATION_IV_INVALID')

  const associatedData = aad(context)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(associatedData)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const fingerprint = createHmac('sha256', key)
    .update(associatedData)
    .update('\u001f')
    .update(secret, 'utf8')
    .digest('hex')

  return {
    ciphertext_b64: ciphertext.toString('base64'),
    iv_b64: iv.toString('base64'),
    auth_tag_b64: authTag.toString('base64'),
    secret_fingerprint: fingerprint,
    key_version: keyVersion,
  }
}

export function openMigrationSecret(sealed, context, keyInput) {
  const key = Buffer.isBuffer(keyInput) ? keyInput : parseMigrationVaultKey(keyInput)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv_b64, 'base64'))
    decipher.setAAD(aad(context))
    decipher.setAuthTag(Buffer.from(sealed.auth_tag_b64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext_b64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new MigrationSecretVaultError('MIGRATION_SECRET_DECRYPT_FAILED')
  }
}
