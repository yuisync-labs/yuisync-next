#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import {
  extname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FoundationStagingOrchestratorError,
  buildStagingRestoreCommand,
  orchestrateFoundationStagingMigration,
} from './foundationStagingOrchestrator.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATION_DIR = resolve(REPO_ROOT, '.migration')
const RUNS_DIR = resolve(MIGRATION_DIR, 'runs')
const ALLOWED_OPTIONS = new Set([
  'snapshot',
  'confirm-tenant',
  'confirm-projection',
])

function usage() {
  return [
    'YuiSync Phase 7 foundation staging orchestrator',
    '',
    'Required environment:',
    '  YUISYNC_STAGING_EDGE_URL=https://<staging-worker-host>',
    '  FOUNDATION_MIGRATION_TOKEN=<server-side migration secret>',
    '  Wrangler must already be authenticated for the Cloudflare account.',
    '',
    'Run:',
    '  node scripts/migration/foundation-staging-orchestrator-cli.mjs \
    --snapshot .migration/source.snapshot.json \
    --confirm-tenant <tenant-id> \
    --confirm-projection phase7-foundation/v1',
    '',
    'The command targets staging only. It never performs Time Travel restore automatically.',
  ].join('\n')
}

function parseArgs(argv) {
  const options = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      throw new FoundationStagingOrchestratorError(
        'CLI_ARGUMENT_INVALID',
        `Unexpected argument: ${token}`,
      )
    }

    const name = token.slice(2)
    if (!ALLOWED_OPTIONS.has(name)) {
      throw new FoundationStagingOrchestratorError(
        'CLI_OPTION_NOT_ALLOWED',
        `Option --${name} is not allowed.`,
      )
    }

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new FoundationStagingOrchestratorError(
        'CLI_ARGUMENT_INVALID',
        `Missing value for --${name}.`,
      )
    }
    if (Object.hasOwn(options, name)) {
      throw new FoundationStagingOrchestratorError(
        'CLI_ARGUMENT_INVALID',
        `Duplicate option: --${name}.`,
      )
    }

    options[name] = value
    index += 1
  }

  return options
}

function requiredOption(options, name) {
  const value = String(options[name] || '').trim()
  if (!value) {
    throw new FoundationStagingOrchestratorError(
      'CLI_OPTION_REQUIRED',
      `--${name} is required.`,
    )
  }
  return value
}

async function resolveSnapshotPath(value) {
  const requested = requiredOption({ snapshot: value }, 'snapshot')
  const candidate = resolve(REPO_ROOT, requested)
  if (extname(candidate).toLowerCase() !== '.json') {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_PATH_NOT_ALLOWED')
  }

  let migrationRealPath
  let snapshotRealPath
  try {
    migrationRealPath = await realpath(MIGRATION_DIR)
    snapshotRealPath = await realpath(candidate)
  } catch {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_READ_FAILED')
  }

  const rel = relative(migrationRealPath, snapshotRealPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_PATH_NOT_ALLOWED')
  }

  return {
    absolutePath: snapshotRealPath,
    label: `.migration/${rel.replaceAll('\\', '/')}`,
  }
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[^0-9TZ]/g, '')
  return `foundation-${timestamp}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function createArtifactWriter(runId) {
  let initialized = false
  const runDir = resolve(RUNS_DIR, runId)

  async function initialize() {
    if (initialized) return
    await mkdir(RUNS_DIR, { recursive: true, mode: 0o700 })
    try {
      await mkdir(runDir, { recursive: false, mode: 0o700 })
    } catch {
      throw new FoundationStagingOrchestratorError('RUN_DIRECTORY_CREATE_FAILED')
    }
    initialized = true
  }

  return {
    runDir,
    async writeArtifact(name, value) {
      await initialize()
      if (!/^[a-z0-9._-]+\.json$/i.test(name)) {
        throw new FoundationStagingOrchestratorError('ARTIFACT_NAME_INVALID')
      }
      const target = resolve(runDir, name)
      if (relative(runDir, target).startsWith('..')) {
        throw new FoundationStagingOrchestratorError('ARTIFACT_NAME_INVALID')
      }
      try {
        await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        if (error instanceof FoundationStagingOrchestratorError) throw error
        throw new FoundationStagingOrchestratorError('ARTIFACT_WRITE_FAILED')
      }
    },
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const snapshotPath = await resolveSnapshotPath(requiredOption(options, 'snapshot'))
  const confirmations = {
    tenantId: requiredOption(options, 'confirm-tenant'),
    projection: requiredOption(options, 'confirm-projection'),
  }

  let snapshotBytes
  try {
    snapshotBytes = await readFile(snapshotPath.absolutePath)
  } catch {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_READ_FAILED')
  }

  const runId = createRunId()
  const artifactWriter = createArtifactWriter(runId)
  const result = await orchestrateFoundationStagingMigration({
    snapshotBytes,
    confirmations,
    stagingBaseUrl: process.env.YUISYNC_STAGING_EDGE_URL,
    migrationToken: process.env.FOUNDATION_MIGRATION_TOKEN,
    sourcePathLabel: snapshotPath.label,
    dependencies: {
      runId,
      writeArtifact: artifactWriter.writeArtifact,
    },
  })

  const runDirLabel = relative(REPO_ROOT, artifactWriter.runDir).replaceAll('\\', '/')
  process.stdout.write(`run_id=${result.run_id}\n`)
  process.stdout.write(`status=${result.status}\n`)
  process.stdout.write(`artifacts=${runDirLabel}\n`)
  process.stdout.write(`prewrite_bookmark=${result.prewrite_bookmark}\n`)

  if (result.exitCode === 2) {
    process.stdout.write('restore_not_executed=true\n')
    process.stdout.write(`restore_command=${result.restore_command}\n`)
  }

  process.exitCode = result.exitCode
}

main().catch((error) => {
  if (error instanceof FoundationStagingOrchestratorError) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
    if (error.causeCode) {
      process.stderr.write(`cause_code=${error.causeCode}\n`)
    }
    if (error.rollbackBookmark) {
      process.stderr.write(`prewrite_bookmark=${error.rollbackBookmark}\n`)
      process.stderr.write('restore_not_executed=true\n')
      process.stderr.write(
        `restore_command=${buildStagingRestoreCommand(error.rollbackBookmark)}\n`,
      )
    }
    process.exitCode = 1
    return
  }

  process.stderr.write('UNEXPECTED_ERROR: foundation staging orchestration failed.\n')
  process.exitCode = 1
})
