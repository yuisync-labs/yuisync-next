#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FoundationExtractorError,
  extractD1FoundationSnapshot,
  extractSupabaseFoundationSnapshot,
} from './foundationExtractors.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATION_DIR = resolve(REPO_ROOT, '.migration')

function usage() {
  return [
    'YuiSync Phase 7 foundation extractor (read-only)',
    '',
    'Supabase source:',
    '  node scripts/migration/foundation-extract-cli.mjs supabase --tenant <id> --module petshop --snapshot-id <id> --output .migration/source.snapshot.json',
    '  Credentials are read only from SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    '',
    'D1 staging destination:',
    '  node scripts/migration/foundation-extract-cli.mjs d1-staging --tenant <id> --module petshop --snapshot-id <id> --output .migration/d1.snapshot.json',
    '',
    'The command never has an apply/write mode. Raw snapshots may contain PII and must stay under .migration/.',
  ].join('\n')
}

function parseArgs(argv) {
  const [command, ...tokens] = argv
  const options = {}

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) {
      throw new FoundationExtractorError('INVALID_CLI_ARGUMENT', `Unexpected argument: ${token}`)
    }

    const name = token.slice(2)
    const value = tokens[index + 1]
    if (!value || value.startsWith('--')) {
      throw new FoundationExtractorError('INVALID_CLI_ARGUMENT', `Missing value for --${name}.`)
    }
    if (Object.hasOwn(options, name)) {
      throw new FoundationExtractorError('INVALID_CLI_ARGUMENT', `Duplicate option: --${name}.`)
    }

    options[name] = value
    index += 1
  }

  return { command, options }
}

function requiredOption(options, name) {
  const value = String(options[name] || '').trim()
  if (!value) throw new FoundationExtractorError('CLI_OPTION_REQUIRED', `--${name} is required.`)
  return value
}

function outputPath(value) {
  const requested = String(value || '').trim()
  if (!requested) throw new FoundationExtractorError('OUTPUT_REQUIRED', '--output is required.')

  const target = resolve(REPO_ROOT, requested)
  const rel = relative(MIGRATION_DIR, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || extname(target).toLowerCase() !== '.json') {
    throw new FoundationExtractorError(
      'OUTPUT_PATH_NOT_ALLOWED',
      'Raw snapshots must be JSON files inside .migration/.',
    )
  }
  return target
}

async function saveSnapshot(snapshot, target) {
  await mkdir(dirname(target), { recursive: true })
  try {
    await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new FoundationExtractorError('OUTPUT_ALREADY_EXISTS', 'Refusing to overwrite an existing snapshot.')
    }
    throw new FoundationExtractorError('OUTPUT_WRITE_FAILED', 'Could not write the local snapshot.')
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (!['supabase', 'd1-staging'].includes(command)) {
    throw new FoundationExtractorError('UNKNOWN_COMMAND', usage())
  }

  const scope = {
    tenant_id: requiredOption(options, 'tenant'),
    module_id: requiredOption(options, 'module'),
  }
  const snapshotId = requiredOption(options, 'snapshot-id')
  const target = outputPath(requiredOption(options, 'output'))

  let snapshot
  if (command === 'supabase') {
    snapshot = await extractSupabaseFoundationSnapshot({
      supabaseUrl: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      snapshotId,
      scope,
    })
  } else {
    snapshot = await extractD1FoundationSnapshot({
      snapshotId,
      scope,
    })
  }

  await saveSnapshot(snapshot, target)
  process.stdout.write(`Snapshot read-only salvo em ${relative(REPO_ROOT, target)}.\n`)
}

main().catch((error) => {
  if (error instanceof FoundationExtractorError) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
    process.exitCode = 1
    return
  }

  process.stderr.write('UNEXPECTED_ERROR: foundation extraction failed.\n')
  process.exitCode = 1
})
