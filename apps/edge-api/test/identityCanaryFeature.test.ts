import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  getIdentityCanaryConfiguration,
  isIdentityCanaryEnabled,
} from '../src/auth/identityCanaryFeature'

const testEnv = env as EdgeEnv & { DB: D1Database }

describe('identity canary feature', () => {
  it('permanece desabilitado por padrão', () => {
    expect(isIdentityCanaryEnabled(undefined)).toBe(false)
    expect(isIdentityCanaryEnabled('false')).toBe(false)
    expect(isIdentityCanaryEnabled('TRUE')).toBe(true)
  })

  it('exige database feature, D1 e configuração do provider quando habilitado', () => {
    expect(getIdentityCanaryConfiguration({})).toEqual({
      ready: false,
      missing: [
        'EDGE_DATABASE_ENABLED',
        'DB',
        'SUPABASE_URL',
        'SUPABASE_PUBLISHABLE_KEY',
      ],
    })
  })

  it('fica configurado somente com todas as dependências explícitas', () => {
    expect(getIdentityCanaryConfiguration({
      EDGE_DATABASE_ENABLED: 'true',
      DB: testEnv.DB,
      SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
    })).toEqual({
      ready: true,
      missing: [],
    })
  })
})
