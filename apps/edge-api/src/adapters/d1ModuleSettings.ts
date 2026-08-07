import type {
  ModuleBaseSettings,
  ModuleBaseSettingsDraft,
  ModuleSettingsPort,
  SaveModuleBaseSettingsRequest,
  SaveModuleBaseSettingsResult,
} from '../../../../server/application/ports/moduleSettings'

const SELECT_SQL = `
SELECT
  tenant_id,
  module_id,
  store_name,
  store_phone,
  store_address,
  store_neighborhood,
  store_city,
  bot_prompt,
  version,
  created_at_ms,
  updated_at_ms
FROM tenant_module_settings
WHERE tenant_id = ?1 AND module_id = ?2
LIMIT 1;
`

const INSERT_SQL = `
INSERT INTO tenant_module_settings (
  tenant_id,
  module_id,
  store_name,
  store_phone,
  store_address,
  store_neighborhood,
  store_city,
  bot_prompt,
  version,
  created_at_ms,
  updated_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)
ON CONFLICT (tenant_id, module_id) DO NOTHING
RETURNING
  tenant_id,
  module_id,
  store_name,
  store_phone,
  store_address,
  store_neighborhood,
  store_city,
  bot_prompt,
  version,
  created_at_ms,
  updated_at_ms;
`

const UPDATE_SQL = `
UPDATE tenant_module_settings
SET
  store_name = COALESCE(?4, store_name),
  store_phone = COALESCE(?5, store_phone),
  store_address = COALESCE(?6, store_address),
  store_neighborhood = COALESCE(?7, store_neighborhood),
  store_city = COALESCE(?8, store_city),
  bot_prompt = COALESCE(?9, bot_prompt),
  version = version + 1,
  updated_at_ms = ?10
WHERE tenant_id = ?1
  AND module_id = ?2
  AND version = ?3
RETURNING
  tenant_id,
  module_id,
  store_name,
  store_phone,
  store_address,
  store_neighborhood,
  store_city,
  bot_prompt,
  version,
  created_at_ms,
  updated_at_ms;
`

type ModuleSettingsRow = Readonly<{
  tenant_id: string
  module_id: string
  store_name: string
  store_phone: string
  store_address: string
  store_neighborhood: string
  store_city: string
  bot_prompt: string
  version: number
  created_at_ms: number
  updated_at_ms: number
}>

export type ModuleSettingsErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'INVALID_ARGUMENT'

export class ModuleSettingsError extends Error {
  readonly code: ModuleSettingsErrorCode

  constructor(code: ModuleSettingsErrorCode) {
    super('Module settings operation could not be completed.')
    this.name = 'ModuleSettingsError'
    this.code = code
  }
}

function normalizeTenantId(value: string): string {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 160) {
    throw new ModuleSettingsError('INVALID_ARGUMENT')
  }
  return normalized
}

function normalizeModuleId(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new ModuleSettingsError('INVALID_ARGUMENT')
  }
  return normalized
}

function normalizeNowMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ModuleSettingsError('INVALID_ARGUMENT')
  }
  return value
}

function normalizeExpectedVersion(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ModuleSettingsError('INVALID_ARGUMENT')
  }
  return value
}

function normalizeOptionalText(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (value === undefined) return null
  const normalized = String(value).trim()
  if (normalized.length > maxLength) {
    throw new ModuleSettingsError('INVALID_ARGUMENT')
  }
  return normalized
}

function normalizeDraft(draft: ModuleBaseSettingsDraft) {
  return {
    storeName: normalizeOptionalText(draft.storeName, 160),
    storePhone: normalizeOptionalText(draft.storePhone, 80),
    storeAddress: normalizeOptionalText(draft.storeAddress, 240),
    storeNeighborhood: normalizeOptionalText(draft.storeNeighborhood, 120),
    storeCity: normalizeOptionalText(draft.storeCity, 120),
    botPrompt: normalizeOptionalText(draft.botPrompt, 12_000),
  }
}

function toSettings(row: ModuleSettingsRow): ModuleBaseSettings {
  return {
    tenantId: row.tenant_id,
    moduleId: row.module_id,
    storeName: row.store_name,
    storePhone: row.store_phone,
    storeAddress: row.store_address,
    storeNeighborhood: row.store_neighborhood,
    storeCity: row.store_city,
    botPrompt: row.bot_prompt,
    version: Number(row.version),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  }
}

export class D1ModuleSettingsAdapter implements ModuleSettingsPort {
  private readonly database?: D1Database

  constructor(database?: D1Database) {
    this.database = database
  }

  async getBaseSettings(
    tenantIdValue: string,
    moduleIdValue: string,
  ): Promise<ModuleBaseSettings | null> {
    const database = this.requireDatabase()
    const tenantId = normalizeTenantId(tenantIdValue)
    const moduleId = normalizeModuleId(moduleIdValue)

    try {
      const row = await database
        .prepare(SELECT_SQL)
        .bind(tenantId, moduleId)
        .first<ModuleSettingsRow>()
      return row ? toSettings(row) : null
    } catch {
      throw new ModuleSettingsError('DATABASE_UNAVAILABLE')
    }
  }

  async saveBaseSettings(
    request: SaveModuleBaseSettingsRequest,
  ): Promise<SaveModuleBaseSettingsResult> {
    const database = this.requireDatabase()
    const tenantId = normalizeTenantId(request.tenantId)
    const moduleId = normalizeModuleId(request.moduleId)
    const expectedVersion = normalizeExpectedVersion(request.expectedVersion)
    const nowMs = normalizeNowMs(request.nowMs)
    const draft = normalizeDraft(request.settings)

    try {
      if (expectedVersion === null) {
        const row = await database
          .prepare(INSERT_SQL)
          .bind(
            tenantId,
            moduleId,
            draft.storeName ?? '',
            draft.storePhone ?? '',
            draft.storeAddress ?? '',
            draft.storeNeighborhood ?? '',
            draft.storeCity ?? '',
            draft.botPrompt ?? '',
            nowMs,
          )
          .first<ModuleSettingsRow>()

        return row
          ? { kind: 'saved', settings: toSettings(row) }
          : { kind: 'conflict' }
      }

      const row = await database
        .prepare(UPDATE_SQL)
        .bind(
          tenantId,
          moduleId,
          expectedVersion,
          draft.storeName,
          draft.storePhone,
          draft.storeAddress,
          draft.storeNeighborhood,
          draft.storeCity,
          draft.botPrompt,
          nowMs,
        )
        .first<ModuleSettingsRow>()

      return row
        ? { kind: 'saved', settings: toSettings(row) }
        : { kind: 'conflict' }
    } catch (error) {
      if (error instanceof ModuleSettingsError) throw error
      throw new ModuleSettingsError('DATABASE_UNAVAILABLE')
    }
  }

  private requireDatabase(): D1Database {
    if (!this.database) {
      throw new ModuleSettingsError('DATABASE_NOT_CONFIGURED')
    }
    return this.database
  }
}
