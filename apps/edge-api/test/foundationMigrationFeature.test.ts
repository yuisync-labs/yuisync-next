import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  getFoundationMigrationConfiguration,
  isFoundationMigrationEnabled,
  verifyFoundationMigrationToken,
} from '../src/migration/foundationMigrationFeature'

const testEnv = env as EdgeEnv & { DB: D1Database }
const TOKEN = 'foundation-migration-token-fixture-1234567890'

describe('foundation migration feature gate', () => {
  it('permanece desabilitado por padrão', () => {
    expect(isFoundationMigrationEnabled(undefined)).toBe(false)
    expect(isFoundationMigrationEnabled('false')).toBe(false)
    expect(isFoundationMigrationEnabled('TRUE')).toBe(true)
  })

  it('só fica ready em staging com D1 e token explícitos', () => {
    expect(getFoundationMigrationConfiguration({
      APP_ENV: 'staging',
      EDGE_DATABASE_ENABLED: 'true',
      DB: testEnv.DB,
      FOUNDATION_MIGRATION_TOKEN: TOKEN,
    })).toEqual({
      ready: true,
      missing: [],
      wrongEnvironment: false,
    })
  })

  it('falha fechado fora de staging mesmo com todas as dependências', () => {
    expect(getFoundationMigrationConfiguration({
      APP_ENV: 'production',
      EDGE_DATABASE_ENABLED: 'true',
      DB: testEnv.DB,
      FOUNDATION_MIGRATION_TOKEN: TOKEN,
    })).toEqual({
      ready: false,
      missing: [],
      wrongEnvironment: true,
    })
  })

  it('identifica dependências ausentes sem expor o valor do token', () => {
    expect(getFoundationMigrationConfiguration({ APP_ENV: 'staging' })).toEqual({
      ready: false,
      missing: ['EDGE_DATABASE_ENABLED', 'DB', 'FOUNDATION_MIGRATION_TOKEN'],
      wrongEnvironment: false,
    })
  })

  it('compara token sem aceitar prefixo, ausência ou token curto', async () => {
    await expect(verifyFoundationMigrationToken(TOKEN, TOKEN)).resolves.toBe(true)
    await expect(verifyFoundationMigrationToken(`${TOKEN}x`, TOKEN)).resolves.toBe(false)
    await expect(verifyFoundationMigrationToken(TOKEN.slice(0, -1), TOKEN)).resolves.toBe(false)
    await expect(verifyFoundationMigrationToken(undefined, TOKEN)).resolves.toBe(false)
    await expect(verifyFoundationMigrationToken(TOKEN, 'short-token')).resolves.toBe(false)
  })
})
