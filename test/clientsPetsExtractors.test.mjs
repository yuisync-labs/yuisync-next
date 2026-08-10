import { describe, expect, it, vi } from 'vitest'

import {
  buildD1ClientsPetsQueries,
  extractD1ClientsPetsSnapshot,
  extractSupabaseClientsPetsSnapshot,
} from '../scripts/migration/clientsPetsExtractors.mjs'

const scope = { tenant_id: 'tenant-test', module_id: 'petshop' }

function sourceRow(overrides = {}) {
  return {
    id: 'pet-1',
    tenant_id: scope.tenant_id,
    module_id: scope.module_id,
    name: 'Maria',
    document: '12345678900',
    phone: '32999990000',
    email: 'maria@example.com',
    address: 'Rua Um',
    neighborhood: 'Centro',
    city: 'Muriae',
    notes: null,
    active: true,
    details: { pet_name: 'Thor', species: 'dog' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('clients/pets extractors', () => {
  it('lê Supabase somente com GET e escopo obrigatório', async () => {
    const calls = []
    const fetcher = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify([sourceRow()]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const snapshot = await extractSupabaseClientsPetsSnapshot({
      supabaseUrl: 'https://example.supabase.co',
      adminApiKey: 'sb_secret_testkey',
      snapshotId: 'source-1',
      scope,
      fetcher,
    })

    expect(snapshot.collections.clients).toHaveLength(1)
    expect(snapshot.collections.pets).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('GET')
    expect(calls[0].init.headers.authorization).toBeUndefined()
    expect(calls[0].url).toContain('tenant_id=eq.tenant-test')
    expect(calls[0].url).toContain('module_id=eq.petshop')
  })

  it('usa Authorization apenas para service-role JWT legado', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.headers.apikey).toBe('legacy.jwt.key')
      expect(init.headers.authorization).toBe('Bearer legacy.jwt.key')
      return new Response(JSON.stringify([]), { status: 200 })
    })

    await extractSupabaseClientsPetsSnapshot({
      supabaseUrl: 'https://example.supabase.co',
      adminApiKey: 'legacy.jwt.key',
      snapshotId: 'source-legacy-key',
      scope,
      fetcher,
    })
  })

  it('gera apenas SELECTs fixos e escopados para D1', () => {
    const queries = buildD1ClientsPetsQueries(scope)
    expect(Object.keys(queries)).toEqual(['clients', 'pets'])
    for (const sql of Object.values(queries)) {
      expect(sql).toMatch(/^SELECT /)
      expect(sql).toContain("tenant_id = 'tenant-test'")
      expect(sql).toContain("module_id = 'petshop'")
      expect(sql).not.toContain(';')
    }
  })

  it('projeta a leitura D1 sem executar qualquer write', async () => {
    const sql = []
    const runner = vi.fn(async (query) => {
      sql.push(query)
      if (query.includes('FROM clients')) {
        return [{
          tenant_id: scope.tenant_id,
          module_id: scope.module_id,
          id: 'client-1',
          name: 'Maria',
          document: '12345678900',
          phone: '32999990000',
          email: 'maria@example.com',
          birth_date: null,
          address: 'Rua Um',
          address_number: null,
          address_complement: null,
          address_reference: null,
          neighborhood: 'Centro',
          city: 'Muriae',
          postal_code: null,
          notes: null,
          status: 'active',
        }]
      }
      return [{
        tenant_id: scope.tenant_id,
        module_id: scope.module_id,
        id: 'pet-1',
        client_id: 'client-1',
        name: 'Thor',
        species: 'dog',
        breed: null,
        birth_date: null,
        weight_kg: null,
        color: null,
        notes: null,
        status: 'active',
      }]
    })

    const snapshot = await extractD1ClientsPetsSnapshot({
      snapshotId: 'd1-1',
      scope,
      runner,
    })

    expect(snapshot.collections.clients).toHaveLength(1)
    expect(snapshot.collections.pets).toHaveLength(1)
    expect(sql).toHaveLength(2)
    expect(sql.every((query) => /^SELECT /.test(query))).toBe(true)
  })
})