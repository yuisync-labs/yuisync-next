import { describe, expect, it, vi } from 'vitest'

import {
  buildMigrationManifest,
  reconcileMigrationManifests,
} from '../scripts/migration/manifest.mjs'
import {
  FoundationExtractorError,
  buildD1FoundationQueries,
  createWranglerD1ReadOnlyRunner,
  extractD1FoundationSnapshot,
  extractSupabaseFoundationSnapshot,
  parseWranglerD1Json,
} from '../scripts/migration/foundationExtractors.mjs'

const scope = { tenant_id: 'tenant-extractor', module_id: 'petshop' }
const serviceRoleKey = 'service-role-test-key'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sourceFetcher(calls) {
  return async (input, init = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })

    if (url.pathname.endsWith('/tenants')) {
      return jsonResponse([
        { id: scope.tenant_id, slug: 'quatro-patas', name: 'Quatro Patas', active: true },
      ])
    }

    if (url.pathname.endsWith('/profile_tenants')) {
      return jsonResponse([
        {
          profile_id: 'auth-user-1',
          tenant_id: scope.tenant_id,
          role: 'employee',
          active: true,
          profiles: {
            id: 'auth-user-1',
            full_name: 'Operador',
            email: 'OPERADOR@EXAMPLE.COM',
            role: 'employee',
            active: true,
          },
        },
      ])
    }

    if (url.pathname.endsWith('/profiles')) {
      return jsonResponse([
        {
          id: 'auth-admin-1',
          full_name: 'Admin Global',
          email: 'ADMIN@EXAMPLE.COM',
          role: 'admin',
          active: true,
        },
      ])
    }

    if (url.pathname.endsWith('/settings')) {
      return jsonResponse([
        {
          tenant_id: scope.tenant_id,
          module_id: 'petshop',
          store_name: 'Quatro Patas',
          store_phone: '32999990000',
          store_address: 'Av. Central, 123',
          store_neighborhood: 'Centro',
          store_city: 'Muriaé',
          bot_prompt: 'Atenda com clareza.',
        },
      ])
    }

    return jsonResponse([], 404)
  }
}

function d1Runner(calls) {
  return async (sql) => {
    calls.push(sql)

    if (/FROM tenants\b/.test(sql)) {
      return [
        { id: scope.tenant_id, slug: 'quatro-patas', name: 'Quatro Patas', status: 'active' },
      ]
    }
    if (/FROM tenant_memberships\b/.test(sql)) {
      return [
        { tenant_id: scope.tenant_id, principal_id: 'principal-user', status: 'active' },
        { tenant_id: scope.tenant_id, principal_id: 'principal-admin', status: 'active' },
      ]
    }
    if (/FROM identity_principals\b/.test(sql)) {
      return [
        {
          id: 'principal-user',
          provider: 'supabase',
          subject: 'auth-user-1',
          display_name: 'Operador',
          email: 'operador@example.com',
          status: 'active',
        },
        {
          id: 'principal-admin',
          provider: 'supabase',
          subject: 'auth-admin-1',
          display_name: 'Admin Global',
          email: 'admin@example.com',
          status: 'active',
        },
      ]
    }
    if (/FROM tenant_module_settings\b/.test(sql)) {
      return [
        {
          tenant_id: scope.tenant_id,
          module_id: 'petshop',
          store_name: 'Quatro Patas',
          store_phone: '32999990000',
          store_address: 'Av. Central, 123',
          store_neighborhood: 'Centro',
          store_city: 'Muriaé',
          bot_prompt: 'Atenda com clareza.',
          version: 4,
          created_at_ms: 1,
          updated_at_ms: 2,
        },
      ]
    }

    throw new Error(`Unexpected SQL: ${sql}`)
  }
}

describe('foundation read-only extractors', () => {
  it('extrai Supabase somente por GET e produz a projection esperada', async () => {
    const calls = []
    const snapshot = await extractSupabaseFoundationSnapshot({
      supabaseUrl: 'https://project-ref.supabase.co',
      serviceRoleKey,
      snapshotId: 'supabase-extraction-fixture',
      scope,
      fetcher: sourceFetcher(calls),
    })

    expect(snapshot.source).toEqual({
      system: 'supabase',
      snapshot_id: 'supabase-extraction-fixture',
    })
    expect(snapshot.collections.tenants).toHaveLength(1)
    expect(snapshot.collections.identity_principals).toHaveLength(2)
    expect(snapshot.collections.tenant_memberships).toHaveLength(2)
    expect(snapshot.collections.tenant_module_settings).toHaveLength(1)

    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(call.init.method).toBe('GET')
      expect(call.init.body).toBeUndefined()
      expect(call.init.redirect).toBe('error')
      expect(call.init.headers.apikey).toBe(serviceRoleKey)
      expect(call.init.headers.authorization).toBe(`Bearer ${serviceRoleKey}`)
    }

    expect(calls.find((call) => call.url.pathname.endsWith('/settings'))?.url.searchParams.get('tenant_id'))
      .toBe(`eq.${scope.tenant_id}`)
    expect(calls.find((call) => call.url.pathname.endsWith('/settings'))?.url.searchParams.get('module_id'))
      .toBe('eq.petshop')
    expect(JSON.stringify(snapshot)).not.toContain(serviceRoleKey)
  })

  it('extrai D1 por quatro SELECTs fixos e reconcilia com o Supabase', async () => {
    const sourceCalls = []
    const d1Calls = []

    const source = await extractSupabaseFoundationSnapshot({
      supabaseUrl: 'https://project-ref.supabase.co',
      serviceRoleKey,
      snapshotId: 'source-fixture',
      scope,
      fetcher: sourceFetcher(sourceCalls),
    })
    const destination = await extractD1FoundationSnapshot({
      snapshotId: 'destination-fixture',
      scope,
      runner: d1Runner(d1Calls),
    })

    expect(d1Calls).toHaveLength(4)
    for (const sql of d1Calls) {
      expect(sql).toMatch(/^SELECT\b/)
      expect(sql).not.toContain(';')
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA)\b/i)
    }

    const report = reconcileMigrationManifests(
      buildMigrationManifest(source),
      buildMigrationManifest(destination),
    )
    expect(report.in_sync).toBe(true)
  })

  it('constrói queries D1 somente com tenant/módulo validados', () => {
    const queries = buildD1FoundationQueries(scope)

    expect(Object.keys(queries)).toEqual(['tenant', 'memberships', 'principals', 'settings'])
    expect(Object.values(queries).every((sql) => /^SELECT\b/.test(sql))).toBe(true)
    expect(Object.values(queries).every((sql) => !sql.includes(';'))).toBe(true)

    expect(() => buildD1FoundationQueries({
      tenant_id: "tenant' OR 1=1 --",
      module_id: 'petshop',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_TENANT_ID' }))
  })

  it('parseia o formato JSON do Wrangler sem aceitar envelopes inválidos', () => {
    expect(parseWranglerD1Json(JSON.stringify([
      { results: [{ id: '1' }], success: true, meta: {} },
    ]))).toEqual([{ id: '1' }])

    expect(parseWranglerD1Json(JSON.stringify({
      results: [{ id: '2' }], success: true,
    }))).toEqual([{ id: '2' }])

    expect(() => parseWranglerD1Json('{invalid')).toThrowError(
      expect.objectContaining({ code: 'D1_RESPONSE_INVALID' }),
    )
    expect(() => parseWranglerD1Json(JSON.stringify([
      { success: false, results: [] },
    ]))).toThrowError(expect.objectContaining({ code: 'D1_QUERY_FAILED' }))
  })

  it('runner Wrangler fixa staging/DB e rejeita qualquer comando não SELECT', async () => {
    const execCalls = []
    const execFile = vi.fn(async (command, args, options) => {
      execCalls.push({ command, args, options })
      return {
        stdout: JSON.stringify([{ results: [{ value: 1 }], success: true }]),
        stderr: '',
      }
    })

    const runner = createWranglerD1ReadOnlyRunner({ execFile })
    await expect(runner('SELECT 1')).resolves.toEqual([{ value: 1 }])

    expect(execCalls).toHaveLength(1)
    const [{ args, options }] = execCalls
    expect(args).toContain('d1')
    expect(args).toContain('execute')
    expect(args).toContain('DB')
    expect(args).toContain('--remote')
    expect(args).toContain('--json')
    expect(args.slice(args.indexOf('--env'), args.indexOf('--env') + 2)).toEqual([
      '--env', 'staging',
    ])
    const configValue = args[args.indexOf('--config') + 1]
    expect(configValue).toMatch(/apps[\\/]edge-api[\\/]wrangler\.jsonc$/)
    expect(options.cwd).toMatch(/yuisync-next[\\/]?$/)

    await expect(runner('UPDATE tenants SET status = \'inactive\'')).rejects.toMatchObject({
      code: 'D1_NON_SELECT_REJECTED',
    })
    expect(execCalls).toHaveLength(1)
  })

  it('não permite apontar o runner para outro ambiente ou binding', () => {
    expect(() => createWranglerD1ReadOnlyRunner({ environment: 'production' })).toThrowError(
      expect.objectContaining({ code: 'D1_ENVIRONMENT_NOT_ALLOWED' }),
    )
    expect(() => createWranglerD1ReadOnlyRunner({ binding: 'OTHER_DB' })).toThrowError(
      expect.objectContaining({ code: 'D1_BINDING_NOT_ALLOWED' }),
    )
  })

  it('não vaza service role em erros de rede ou HTTP', async () => {
    const failingNetwork = async () => {
      throw new Error(`secret=${serviceRoleKey}`)
    }

    let networkError
    try {
      await extractSupabaseFoundationSnapshot({
        supabaseUrl: 'https://project-ref.supabase.co',
        serviceRoleKey,
        snapshotId: 'network-error',
        scope,
        fetcher: failingNetwork,
      })
    } catch (error) {
      networkError = error
    }

    expect(networkError).toBeInstanceOf(FoundationExtractorError)
    expect(networkError).toMatchObject({ code: 'SUPABASE_UNAVAILABLE' })
    expect(String(networkError.message)).not.toContain(serviceRoleKey)

    const failingHttp = async () => new Response('sensitive provider body', { status: 500 })
    await expect(extractSupabaseFoundationSnapshot({
      supabaseUrl: 'https://project-ref.supabase.co',
      serviceRoleKey,
      snapshotId: 'http-error',
      scope,
      fetcher: failingHttp,
    })).rejects.toMatchObject({
      code: 'SUPABASE_READ_FAILED',
      message: 'Supabase read failed with HTTP 500.',
    })
  })
})
