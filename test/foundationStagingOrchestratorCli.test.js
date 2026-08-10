import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const CLI = resolve('scripts/migration/foundation-staging-orchestrator-cli.mjs')
let externalDir
let externalSnapshot

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      YUISYNC_STAGING_EDGE_URL: '',
      FOUNDATION_MIGRATION_TOKEN: '',
      ...env,
    },
  })
}

function confirmations() {
  return [
    '--confirm-tenant', 'tenant-cli-guard',
    '--confirm-projection', 'phase7-foundation/v1',
  ]
}

beforeAll(() => {
  mkdirSync(resolve('.migration'), { recursive: true })
  externalDir = mkdtempSync(join(tmpdir(), 'yuisync-orchestrator-cli-'))
  externalSnapshot = join(externalDir, 'source.snapshot.json')
  writeFileSync(externalSnapshot, '{}', 'utf8')
})

afterAll(() => {
  if (externalDir) rmSync(externalDir, { recursive: true, force: true })
})

describe('foundation staging orchestrator CLI guards', () => {
  it.each([
    ['--token', 'should-never-be-a-cli-secret'],
    ['--staging-url', 'https://production.example.test'],
    ['--env', 'production'],
    ['--binding', 'OTHER_DB'],
  ])('rejeita opção operacional não permitida %s', (option, value) => {
    const result = run([
      '--snapshot', '.migration/does-not-need-to-exist.json',
      ...confirmations(),
      option, value,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CLI_OPTION_NOT_ALLOWED')
    expect(result.stderr).not.toContain('should-never-be-a-cli-secret')
  })

  it('rejeita snapshot físico fora de .migration antes de validar URL/token', () => {
    const result = run([
      '--snapshot', externalSnapshot,
      ...confirmations(),
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('SNAPSHOT_PATH_NOT_ALLOWED')
    expect(result.stderr).not.toContain('STAGING_URL_REQUIRED')
    expect(result.stdout).toBe('')
  })

  it('exige confirmação explícita de tenant e projection', () => {
    const missingTenant = run([
      '--snapshot', '.migration/source.snapshot.json',
      '--confirm-projection', 'phase7-foundation/v1',
    ])
    expect(missingTenant.status).toBe(1)
    expect(missingTenant.stderr).toContain('CLI_OPTION_REQUIRED')

    const missingProjection = run([
      '--snapshot', '.migration/source.snapshot.json',
      '--confirm-tenant', 'tenant-cli-guard',
    ])
    expect(missingProjection.status).toBe(1)
    expect(missingProjection.stderr).toContain('CLI_OPTION_REQUIRED')
  })
})
