import {
  parseWhatsAppAccountConnectionV1,
  type WhatsAppAccountConnectionV1,
} from '../../../../shared/contracts/v1/index'
import type { WhatsAppConnectionRepositoryPort } from '../../../../server/application/ports/whatsapp'

type ConnectionRow = Readonly<{
  tenant_id: string
  business_id: string
  waba_id: string
  phone_number_id: string
  display_phone_number: string | null
  verified_name: string | null
  status: 'pending' | 'connected' | 'disabled'
}>

type OwnershipRow = Readonly<{
  tenant_id: string
  waba_id?: string
}>

export type WhatsAppConnectionRepositoryErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'CONNECTION_CONFLICT'

export class WhatsAppConnectionRepositoryError extends Error {
  readonly code: WhatsAppConnectionRepositoryErrorCode

  constructor(code: WhatsAppConnectionRepositoryErrorCode) {
    super('WhatsApp account connection could not be persisted.')
    this.name = 'WhatsAppConnectionRepositoryError'
    this.code = code
  }
}

function fromRow(row: ConnectionRow): WhatsAppAccountConnectionV1 {
  return parseWhatsAppAccountConnectionV1({
    type: 'whatsapp_account_connection',
    version: 1,
    tenant_id: row.tenant_id,
    business_id: row.business_id,
    waba_id: row.waba_id,
    phone_number_id: row.phone_number_id,
    display_phone_number: row.display_phone_number,
    verified_name: row.verified_name,
    status: row.status,
  })
}

const CONNECTION_SELECT = `
SELECT
  p.tenant_id,
  a.business_id,
  p.waba_id,
  p.phone_number_id,
  p.display_phone_number,
  p.verified_name,
  p.status
FROM whatsapp_phone_connections p
JOIN whatsapp_waba_accounts a
  ON a.waba_id = p.waba_id AND a.tenant_id = p.tenant_id
`

export class D1WhatsAppConnectionRepository implements WhatsAppConnectionRepositoryPort {
  private readonly database?: D1Database
  private readonly now: () => number

  constructor(database?: D1Database, now: () => number = Date.now) {
    this.database = database
    this.now = now
  }

  async findByTenantId(tenantId: string): Promise<readonly WhatsAppAccountConnectionV1[]> {
    const database = this.requireDatabase()
    try {
      const result = await database.prepare(`${CONNECTION_SELECT}
WHERE p.tenant_id = ?1
ORDER BY p.phone_number_id ASC
`).bind(tenantId).all<ConnectionRow>()
      return (result.results ?? []).map(fromRow)
    } catch {
      throw new WhatsAppConnectionRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  async findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppAccountConnectionV1 | null> {
    const database = this.requireDatabase()
    try {
      const row = await database.prepare(`${CONNECTION_SELECT}
WHERE p.phone_number_id = ?1
LIMIT 1
`).bind(phoneNumberId).first<ConnectionRow>()
      return row ? fromRow(row) : null
    } catch {
      throw new WhatsAppConnectionRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  async findByWabaId(wabaId: string): Promise<readonly WhatsAppAccountConnectionV1[]> {
    const database = this.requireDatabase()
    try {
      const result = await database.prepare(`${CONNECTION_SELECT}
WHERE p.waba_id = ?1
ORDER BY p.phone_number_id ASC
`).bind(wabaId).all<ConnectionRow>()
      return (result.results ?? []).map(fromRow)
    } catch {
      throw new WhatsAppConnectionRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  async save(connection: WhatsAppAccountConnectionV1): Promise<void> {
    const database = this.requireDatabase()
    const validated = parseWhatsAppAccountConnectionV1(connection)
    const now = this.now()

    try {
      const [wabaOwner, phoneOwner] = await Promise.all([
        database.prepare('SELECT tenant_id FROM whatsapp_waba_accounts WHERE waba_id=?1 LIMIT 1')
          .bind(validated.waba_id)
          .first<OwnershipRow>(),
        database.prepare('SELECT tenant_id,waba_id FROM whatsapp_phone_connections WHERE phone_number_id=?1 LIMIT 1')
          .bind(validated.phone_number_id)
          .first<OwnershipRow>(),
      ])

      if (wabaOwner && wabaOwner.tenant_id !== validated.tenant_id) {
        throw new WhatsAppConnectionRepositoryError('CONNECTION_CONFLICT')
      }
      if (phoneOwner && (
        phoneOwner.tenant_id !== validated.tenant_id
        || phoneOwner.waba_id !== validated.waba_id
      )) {
        throw new WhatsAppConnectionRepositoryError('CONNECTION_CONFLICT')
      }

      await database.batch([
        database.prepare(`
          INSERT INTO whatsapp_waba_accounts(
            waba_id,tenant_id,business_id,status,created_at_ms,updated_at_ms
          ) VALUES(?1,?2,?3,?4,?5,?5)
          ON CONFLICT(waba_id) DO UPDATE SET
            business_id=excluded.business_id,
            status=excluded.status,
            updated_at_ms=excluded.updated_at_ms
          WHERE whatsapp_waba_accounts.tenant_id=excluded.tenant_id
        `).bind(
          validated.waba_id,
          validated.tenant_id,
          validated.business_id,
          validated.status,
          now,
        ),
        database.prepare(`
          INSERT INTO whatsapp_phone_connections(
            phone_number_id,tenant_id,waba_id,display_phone_number,verified_name,status,created_at_ms,updated_at_ms
          ) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)
          ON CONFLICT(phone_number_id) DO UPDATE SET
            display_phone_number=excluded.display_phone_number,
            verified_name=excluded.verified_name,
            status=excluded.status,
            updated_at_ms=excluded.updated_at_ms
          WHERE whatsapp_phone_connections.tenant_id=excluded.tenant_id
            AND whatsapp_phone_connections.waba_id=excluded.waba_id
        `).bind(
          validated.phone_number_id,
          validated.tenant_id,
          validated.waba_id,
          validated.display_phone_number ?? null,
          validated.verified_name ?? null,
          validated.status,
          now,
        ),
      ])

      const persisted = await this.findByPhoneNumberId(validated.phone_number_id)
      if (!persisted
        || persisted.tenant_id !== validated.tenant_id
        || persisted.waba_id !== validated.waba_id
        || persisted.business_id !== validated.business_id) {
        throw new WhatsAppConnectionRepositoryError('CONNECTION_CONFLICT')
      }
    } catch (error) {
      if (error instanceof WhatsAppConnectionRepositoryError) throw error
      throw new WhatsAppConnectionRepositoryError('DATABASE_UNAVAILABLE')
    }
  }

  private requireDatabase(): D1Database {
    if (!this.database) {
      throw new WhatsAppConnectionRepositoryError('DATABASE_NOT_CONFIGURED')
    }
    return this.database
  }
}
