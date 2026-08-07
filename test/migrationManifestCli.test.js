import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const CLI = resolve('scripts/migration/manifest-cli.mjs')

function writeJson(dir, name, value) {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(value), 'utf8')
  return file
}

function fixture(system, storeName = 'Fixture Store') {
  return {
    projection: { name: 'phase7-foundation', version: 1 },
    source: { system, snapshot_id: `${system}-fixture` },
    scope: { tenant_id: 'tenant-cli', module_id: 'petshop' },
    collections: {
      tenant_module_settings: [
        {
          key: 'tenant-cli:petshop',
          data: {
            tenant_id: 'tenant-cli',
            module_id: 'petshop',
            store_name: storeName,
          },
        },
      ],
    },
  }
}

describe('migration manifest CLI', () => {
  it('build gera manifest em stdout sem payload bruto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yuisync-manifest-'))
    const input = writeJson(dir, 'snapshot.json', fixture('supabase'))

    const result = spawnSync(process.execPath, [CLI, 'build', '--input', input], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const manifest = JSON.parse(result.stdout)
    expect(manifest.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.projection).toEqual({ name: 'phase7-foundation', version: 1 })
    expect(result.stdout).not.toContain('Fixture Store')
    expect(result.stdout).not.toContain('tenant-cli:petshop')
  })

  it('reconcile retorna exit code 0 quando snapshots estão em sync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yuisync-reconcile-'))
    const sourceSnapshot = writeJson(dir, 'source-snapshot.json', fixture('supabase'))
    const destinationSnapshot = writeJson(dir, 'destination-snapshot.json', fixture('d1'))
    const sourceManifest = join(dir, 'source.manifest.json')
    const destinationManifest = join(dir, 'destination.manifest.json')

    const sourceBuild = spawnSync(process.execPath, [
      CLI, 'build', '--input', sourceSnapshot, '--output', sourceManifest,
    ], { encoding: 'utf8' })
    const destinationBuild = spawnSync(process.execPath, [
      CLI, 'build', '--input', destinationSnapshot, '--output', destinationManifest,
    ], { encoding: 'utf8' })

    expect(sourceBuild.status).toBe(0)
    expect(destinationBuild.status).toBe(0)

    const result = spawnSync(process.execPath, [
      CLI,
      'reconcile',
      '--source', sourceManifest,
      '--destination', destinationManifest,
    ], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      in_sync: true,
      projection: { name: 'phase7-foundation', version: 1 },
    })
  })

  it('reconcile retorna exit code 2 quando há divergência', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yuisync-reconcile-diff-'))
    const sourceSnapshot = writeJson(dir, 'source-snapshot.json', fixture('supabase'))
    const destinationSnapshot = writeJson(
      dir,
      'destination-snapshot.json',
      fixture('d1', 'Different Store'),
    )
    const sourceManifest = join(dir, 'source.manifest.json')
    const destinationManifest = join(dir, 'destination.manifest.json')

    expect(spawnSync(process.execPath, [
      CLI, 'build', '--input', sourceSnapshot, '--output', sourceManifest,
    ]).status).toBe(0)
    expect(spawnSync(process.execPath, [
      CLI, 'build', '--input', destinationSnapshot, '--output', destinationManifest,
    ]).status).toBe(0)

    const result = spawnSync(process.execPath, [
      CLI,
      'reconcile',
      '--source', sourceManifest,
      '--destination', destinationManifest,
    ], { encoding: 'utf8' })

    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ in_sync: false })
    expect(result.stdout).not.toContain('Different Store')
  })
})
