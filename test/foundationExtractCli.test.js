import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const CLI = resolve('scripts/migration/foundation-extract-cli.mjs')

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      ...env,
    },
  })
}

function baseArgs(output) {
  return [
    'supabase',
    '--tenant', 'tenant-cli-guard',
    '--module', 'petshop',
    '--snapshot-id', 'cli-guard-snapshot',
    '--output', output,
  ]
}

describe('foundation extraction CLI guards', () => {
  it('rejeita snapshot bruto fora de .migration antes de acessar qualquer provider', () => {
    const result = run(baseArgs('tmp/source.snapshot.json'))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('OUTPUT_PATH_NOT_ALLOWED')
    expect(result.stdout).toBe('')
  })

  it('rejeita credenciais passadas como argumento de processo', () => {
    const result = run([
      ...baseArgs('.migration/cli-secret-arg.snapshot.json'),
      '--api-key', 'should-not-be-in-process-list',
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CLI_OPTION_NOT_ALLOWED')
    expect(result.stderr).not.toContain('should-not-be-in-process-list')
  })

  it('falha fechado sem configuração Supabase e não cria snapshot', () => {
    const output = '.migration/cli-missing-config.snapshot.json'
    const absoluteOutput = resolve(output)
    const result = run(baseArgs(output))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('INVALID_SUPABASE_URL')
    expect(result.stdout).toBe('')
    expect(existsSync(absoluteOutput)).toBe(false)
  })

  it('não oferece comando de apply/import', () => {
    const result = run([
      'apply',
      '--tenant', 'tenant-cli-guard',
      '--module', 'petshop',
      '--snapshot-id', 'cli-guard-snapshot',
      '--output', '.migration/never.snapshot.json',
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('UNKNOWN_COMMAND')
    expect(result.stderr).toContain('read-only')
  })
})
