import { describe, expect, it } from 'vitest'

import {
  MigrationManifestError,
  buildMigrationManifest,
  canonicalJson,
  reconcileMigrationManifests,
} from '../scripts/migration/manifest.mjs'

function snapshot(overrides = {}) {
  return {
    projection: {
      name: 'phase7-foundation',
      version: 1,
    },
    source: {
      system: 'supabase',
      snapshot_id: 'fixture-001',
    },
    scope: {
      tenant_id: 'tenant-fixture',
      module_id: 'petshop',
    },
    collections: {
      tenant_module_settings: [
        {
          key: 'tenant-fixture:petshop',
          data: {
            tenant_id: 'tenant-fixture',
            module_id: 'petshop',
            store_name: 'Fixture Store',
            store_city: 'Muriaé',
          },
        },
      ],
    },
    ...overrides,
  }
}

describe('migration manifest foundation', () => {
  it('canonicaliza objetos independentemente da ordem das chaves', () => {
    expect(canonicalJson({ b: 2, a: { y: true, x: 'ok' } })).toBe(
      canonicalJson({ a: { x: 'ok', y: true }, b: 2 }),
    )
  })

  it('gera o mesmo manifest para registros em ordem diferente', () => {
    const first = snapshot({
      collections: {
        tenants: [
          { key: 'tenant-b', data: { id: 'tenant-b', name: 'B' } },
          { key: 'tenant-a', data: { id: 'tenant-a', name: 'A' } },
        ],
      },
    })
    const second = snapshot({
      collections: {
        tenants: [
          { key: 'tenant-a', data: { name: 'A', id: 'tenant-a' } },
          { key: 'tenant-b', data: { name: 'B', id: 'tenant-b' } },
        ],
      },
    })

    expect(buildMigrationManifest(first)).toEqual(buildMigrationManifest(second))
  })

  it('não inclui chave lógica nem dados brutos no manifest', () => {
    const manifest = buildMigrationManifest(snapshot())
    const serialized = JSON.stringify(manifest)

    expect(serialized).not.toContain('tenant-fixture:petshop')
    expect(serialized).not.toContain('Fixture Store')
    expect(serialized).not.toContain('Muriaé')
    expect(manifest.projection).toEqual({ name: 'phase7-foundation', version: 1 })
    expect(manifest.collections[0].records[0]).toEqual({
      key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('rejeita campos com aparência de segredo antes de gerar hashes', () => {
    expect(() => buildMigrationManifest(snapshot({
      collections: {
        unsafe: [
          {
            key: 'row-1',
            data: {
              id: 'row-1',
              service_role_key: 'should-never-enter-a-manifest',
            },
          },
        ],
      },
    }))).toThrowError(expect.objectContaining({
      name: 'MigrationManifestError',
      code: 'SECRET_FIELD',
    }))
  })

  it('rejeita chave lógica duplicada dentro da mesma coleção', () => {
    expect(() => buildMigrationManifest(snapshot({
      collections: {
        tenants: [
          { key: 'same', data: { id: 'a' } },
          { key: 'same', data: { id: 'b' } },
        ],
      },
    }))).toThrowError(expect.objectContaining({
      code: 'DUPLICATE_RECORD_KEY',
    }))
  })

  it('marca manifests idênticos como sincronizados', () => {
    const source = buildMigrationManifest(snapshot())
    const destination = buildMigrationManifest(snapshot({
      source: {
        system: 'd1',
        snapshot_id: 'fixture-destination',
      },
    }))

    expect(reconcileMigrationManifests(source, destination)).toMatchObject({
      in_sync: true,
      projection: {
        name: 'phase7-foundation',
        version: 1,
      },
      scope: {
        tenant_id: 'tenant-fixture',
        module_id: 'petshop',
      },
      collections: [
        {
          name: 'tenant_module_settings',
          source_row_count: 1,
          destination_row_count: 1,
          missing: [],
          extra: [],
          mismatched: [],
          in_sync: true,
        },
      ],
    })
  })

  it('separa registros ausentes, extras e divergentes sem revelar as chaves', () => {
    const source = buildMigrationManifest(snapshot({
      collections: {
        clients: [
          { key: 'client-a', data: { id: 'a', name: 'Ana' } },
          { key: 'client-b', data: { id: 'b', name: 'Bia' } },
        ],
      },
    }))
    const destination = buildMigrationManifest(snapshot({
      source: { system: 'd1', snapshot_id: 'fixture-destination-2' },
      collections: {
        clients: [
          { key: 'client-a', data: { id: 'a', name: 'Ana changed' } },
          { key: 'client-c', data: { id: 'c', name: 'Caio' } },
        ],
      },
    }))

    const report = reconcileMigrationManifests(source, destination)
    expect(report.in_sync).toBe(false)
    expect(report.collections[0].missing).toHaveLength(1)
    expect(report.collections[0].extra).toHaveLength(1)
    expect(report.collections[0].mismatched).toHaveLength(1)
    expect(JSON.stringify(report)).not.toContain('client-a')
    expect(JSON.stringify(report)).not.toContain('client-b')
    expect(JSON.stringify(report)).not.toContain('client-c')
    expect(JSON.stringify(report)).not.toContain('Ana changed')
  })

  it('bloqueia reconciliação entre tenants ou módulos diferentes', () => {
    const source = buildMigrationManifest(snapshot())
    const destination = buildMigrationManifest(snapshot({
      source: { system: 'd1', snapshot_id: 'fixture-destination-3' },
      scope: { tenant_id: 'tenant-other', module_id: 'petshop' },
    }))

    expect(() => reconcileMigrationManifests(source, destination)).toThrowError(
      expect.objectContaining({ code: 'SCOPE_MISMATCH' }),
    )
  })

  it('bloqueia reconciliação entre projeções diferentes', () => {
    const source = buildMigrationManifest(snapshot())
    const destination = buildMigrationManifest(snapshot({
      source: { system: 'd1', snapshot_id: 'fixture-destination-4' },
      projection: { name: 'phase7-foundation', version: 2 },
    }))

    expect(() => reconcileMigrationManifests(source, destination)).toThrowError(
      expect.objectContaining({ code: 'PROJECTION_MISMATCH' }),
    )
  })

  it('detecta manifest alterado depois da geração', () => {
    const source = buildMigrationManifest(snapshot())
    const destination = structuredClone(source)
    destination.collections[0].row_count = 999

    expect(() => reconcileMigrationManifests(source, destination)).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_CHECKSUM_MISMATCH' }),
    )
  })

  it('usa erro tipado para valores incompatíveis com JSON', () => {
    expect(() => canonicalJson({ amount: Number.NaN })).toThrowError(MigrationManifestError)
    expect(() => canonicalJson({ when: new Date() })).toThrowError(
      expect.objectContaining({ code: 'NON_JSON_OBJECT' }),
    )
  })
})
