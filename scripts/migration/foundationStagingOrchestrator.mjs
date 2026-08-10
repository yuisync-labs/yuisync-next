import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  FoundationExtractorError,
  extractD1FoundationSnapshot,
} from './foundationExtractors.mjs'
import {
  MigrationManifestError,
  buildMigrationManifest,
  reconcileMigrationManifests,
} from './manifest.mjs'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WRANGLER_CONFIG = resolve(REPO_ROOT, 'apps/edge-api/wrangler.jsonc')
const FOUNDATION_ROUTE = '/internal/migration/foundation'
const EXPECTED_PROJECTION = 'phase7-foundation/v1'
const MAX_SNAPSHOT_BYTES = 256 * 1024
const MAX_WRANGLER_OUTPUT_BYTES = 1024 * 1024
const BOOKMARK_MAX_LENGTH = 2048

export class FoundationStagingOrchestratorError extends Error {
  constructor(
    code,
    message = 'Foundation staging orchestration failed.',
    { rollbackBookmark = null, causeCode = null } = {},
  ) {
    super(message)
    this.name = 'FoundationStagingOrchestratorError'
    this.code = code
    this.rollbackBookmark = rollbackBookmark
    this.causeCode = causeCode
  }
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requiredText(value, code, maxLength = 512) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maxLength) {
    throw new FoundationStagingOrchestratorError(code)
  }
  return normalized
}

function validMigrationToken(value) {
  return typeof value === 'string'
    && value.length >= 32
    && value.length <= 512
    && value.trim() === value
    && !/[\r\n]/.test(value)
}

function normalizeStagingBaseUrl(value) {
  let url
  try {
    url = new URL(requiredText(value, 'STAGING_URL_REQUIRED', 2048))
  } catch (error) {
    if (error instanceof FoundationStagingOrchestratorError) throw error
    throw new FoundationStagingOrchestratorError('STAGING_URL_INVALID')
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new FoundationStagingOrchestratorError('STAGING_URL_INVALID')
  }

  url.pathname = '/'
  return url
}

function projectionLabel(manifest) {
  return `${manifest.projection?.name || ''}/v${manifest.projection?.version || ''}`
}

function validateSourceManifest(manifest, confirmations) {
  if (manifest.source?.system !== 'supabase') {
    throw new FoundationStagingOrchestratorError('SOURCE_SYSTEM_NOT_ALLOWED')
  }

  const projection = projectionLabel(manifest)
  if (projection !== EXPECTED_PROJECTION) {
    throw new FoundationStagingOrchestratorError('PROJECTION_NOT_ALLOWED')
  }

  const confirmedTenant = requiredText(
    confirmations?.tenantId,
    'TENANT_CONFIRMATION_REQUIRED',
    160,
  )
  const confirmedProjection = requiredText(
    confirmations?.projection,
    'PROJECTION_CONFIRMATION_REQUIRED',
    80,
  )

  if (confirmedTenant !== manifest.scope?.tenant_id) {
    throw new FoundationStagingOrchestratorError('TENANT_CONFIRMATION_MISMATCH')
  }
  if (confirmedProjection !== projection) {
    throw new FoundationStagingOrchestratorError('PROJECTION_CONFIRMATION_MISMATCH')
  }
}

export function parseTimeTravelBookmarkJson(stdout) {
  let payload
  try {
    payload = JSON.parse(String(stdout || '').trim())
  } catch {
    throw new FoundationStagingOrchestratorError('TIME_TRAVEL_RESPONSE_INVALID')
  }

  const unwrap = (value, depth = 0) => {
    if (depth > 3) return null
    if (Array.isArray(value)) {
      return value.length === 1 ? unwrap(value[0], depth + 1) : null
    }
    if (!value || typeof value !== 'object') return null

    if (typeof value.bookmark === 'string') return value.bookmark
    if (value.result) return unwrap(value.result, depth + 1)
    return null
  }

  const bookmark = String(unwrap(payload) || '').trim()
  if (!bookmark || bookmark.length > BOOKMARK_MAX_LENGTH || /[\r\n]/.test(bookmark)) {
    throw new FoundationStagingOrchestratorError('TIME_TRAVEL_BOOKMARK_INVALID')
  }
  return bookmark
}

export function createStagingTimeTravelBookmarkCapture({ execFile = execFileAsync } = {}) {
  return async function captureBookmark() {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    let result
    try {
      result = await execFile(npmCommand, [
        'exec',
        '--workspace', '@yuisync/edge-api',
        '--',
        'wrangler',
        'd1',
        'time-travel',
        'info',
        'DB',
        '--env', 'staging',
        '--config', WRANGLER_CONFIG,
        '--json',
      ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: MAX_WRANGLER_OUTPUT_BYTES,
        windowsHide: true,
      })
    } catch {
      throw new FoundationStagingOrchestratorError('TIME_TRAVEL_BOOKMARK_FAILED')
    }

    return parseTimeTravelBookmarkJson(result?.stdout)
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

export function buildStagingRestoreCommand(bookmark) {
  const normalizedBookmark = requiredText(bookmark, 'TIME_TRAVEL_BOOKMARK_INVALID', BOOKMARK_MAX_LENGTH)
  if (/[\r\n]/.test(normalizedBookmark)) {
    throw new FoundationStagingOrchestratorError('TIME_TRAVEL_BOOKMARK_INVALID')
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return [
    npmCommand,
    'exec',
    '--workspace',
    '@yuisync/edge-api',
    '--',
    'wrangler',
    'd1',
    'time-travel',
    'restore',
    'DB',
    '--env',
    'staging',
    '--config',
    WRANGLER_CONFIG,
    '--bookmark',
    normalizedBookmark,
    '--json',
  ].map(shellQuote).join(' ')
}

export function createFoundationStagingPoster({ fetcher = fetch } = {}) {
  return async function postSnapshot({ baseUrl, migrationToken, snapshotBytes, snapshotSha256, runId }) {
    const normalizedBaseUrl = normalizeStagingBaseUrl(baseUrl)
    if (!validMigrationToken(migrationToken)) {
      throw new FoundationStagingOrchestratorError('MIGRATION_TOKEN_INVALID')
    }

    const endpoint = new URL(FOUNDATION_ROUTE, normalizedBaseUrl)
    let response
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': runId,
          'x-yuisync-migration-token': migrationToken,
          'x-yuisync-migration-snapshot-sha256': snapshotSha256,
        },
        body: snapshotBytes,
        redirect: 'error',
      })
    } catch {
      throw new FoundationStagingOrchestratorError('STAGING_TRANSPORT_UNAVAILABLE')
    }

    let payload = null
    try {
      payload = await response.json()
    } catch {
      throw new FoundationStagingOrchestratorError('STAGING_TRANSPORT_PROTOCOL_ERROR')
    }

    if (!response.ok) {
      const code = typeof payload?.code === 'string' ? payload.code : null
      throw new FoundationStagingOrchestratorError(
        'STAGING_WRITE_REJECTED',
        `Staging transport rejected the migration with HTTP ${response.status}.`,
        { causeCode: code },
      )
    }

    if (
      payload?.status !== 'applied_or_already_present'
      || payload?.request_id !== runId
    ) {
      throw new FoundationStagingOrchestratorError('STAGING_TRANSPORT_PROTOCOL_ERROR')
    }

    return {
      status: payload.status,
      request_id: payload.request_id,
      identity_count: Number(payload.identity_count || 0),
      membership_count: Number(payload.membership_count || 0),
      settings_present: Boolean(payload.settings_present),
      statement_count: Number(payload.statement_count || 0),
    }
  }
}

function runIdFrom({ now = () => new Date(), randomId = () => randomUUID() } = {}) {
  const stamp = now().toISOString().replace(/[^0-9TZ]/g, '')
  const suffix = String(randomId()).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
  return `foundation-${stamp}-${suffix}`
}

function safeFailureCode(error) {
  if (error instanceof FoundationStagingOrchestratorError) return error.code
  if (error instanceof MigrationManifestError) return `MANIFEST_${error.code}`
  if (error instanceof FoundationExtractorError) return `EXTRACTOR_${error.code}`
  return 'UNEXPECTED_ERROR'
}

export async function orchestrateFoundationStagingMigration({
  snapshotBytes,
  confirmations,
  stagingBaseUrl,
  migrationToken,
  sourcePathLabel,
  dependencies = {},
} = {}) {
  if (!(snapshotBytes instanceof Uint8Array) || snapshotBytes.byteLength === 0) {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_BYTES_INVALID')
  }
  if (snapshotBytes.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_TOO_LARGE')
  }

  let sourceSnapshot
  try {
    sourceSnapshot = JSON.parse(new TextDecoder().decode(snapshotBytes))
  } catch {
    throw new FoundationStagingOrchestratorError('SNAPSHOT_JSON_INVALID')
  }

  const sourceManifest = buildMigrationManifest(sourceSnapshot)
  validateSourceManifest(sourceManifest, confirmations)
  const normalizedBaseUrl = normalizeStagingBaseUrl(stagingBaseUrl)
  if (!validMigrationToken(migrationToken)) {
    throw new FoundationStagingOrchestratorError('MIGRATION_TOKEN_INVALID')
  }

  const captureBookmark = dependencies.captureBookmark
    ?? createStagingTimeTravelBookmarkCapture()
  const postSnapshot = dependencies.postSnapshot
    ?? createFoundationStagingPoster()
  const extractDestination = dependencies.extractDestination
    ?? ((input) => extractD1FoundationSnapshot(input))
  const writeArtifact = dependencies.writeArtifact ?? (async () => {})
  const runId = dependencies.runId ?? runIdFrom(dependencies)
  const snapshotSha256 = sha256Hex(snapshotBytes)
  const targetUrl = new URL(FOUNDATION_ROUTE, normalizedBaseUrl).toString()

  await writeArtifact('source.manifest.json', sourceManifest)

  const bookmark = await captureBookmark()
  const restoreCommand = buildStagingRestoreCommand(bookmark)
  const plan = {
    run_id: runId,
    environment: 'staging',
    source_snapshot: sourcePathLabel || null,
    snapshot_sha256: snapshotSha256,
    source_manifest_checksum: sourceManifest.checksum,
    projection: sourceManifest.projection,
    scope: sourceManifest.scope,
    prewrite_bookmark: bookmark,
    target_url: targetUrl,
  }
  await writeArtifact('plan.json', plan)

  try {
    const transport = await postSnapshot({
      baseUrl: normalizedBaseUrl.toString(),
      migrationToken,
      snapshotBytes,
      snapshotSha256,
      runId,
    })
    await writeArtifact('transport.json', transport)

    const destinationSnapshot = await extractDestination({
      snapshotId: `d1-staging-after-${runId}`,
      scope: sourceManifest.scope,
    })
    await writeArtifact('destination.snapshot.json', destinationSnapshot)

    const destinationManifest = buildMigrationManifest(destinationSnapshot)
    await writeArtifact('destination.manifest.json', destinationManifest)

    const reconciliation = reconcileMigrationManifests(
      sourceManifest,
      destinationManifest,
    )
    await writeArtifact('reconciliation.json', reconciliation)

    const result = {
      run_id: runId,
      status: reconciliation.in_sync ? 'in_sync' : 'diverged',
      source_manifest_checksum: sourceManifest.checksum,
      destination_manifest_checksum: destinationManifest.checksum,
      snapshot_sha256: snapshotSha256,
      prewrite_bookmark: bookmark,
      restore_command: restoreCommand,
    }
    await writeArtifact('result.json', result)

    return {
      ...result,
      exitCode: reconciliation.in_sync ? 0 : 2,
      reconciliation,
    }
  } catch (error) {
    const failure = {
      run_id: runId,
      status: 'failed',
      code: safeFailureCode(error),
      prewrite_bookmark: bookmark,
      restore_command: restoreCommand,
    }
    await writeArtifact('failure.json', failure)

    if (error instanceof FoundationStagingOrchestratorError) {
      throw new FoundationStagingOrchestratorError(
        error.code,
        error.message,
        {
          rollbackBookmark: bookmark,
          causeCode: error.causeCode,
        },
      )
    }

    throw new FoundationStagingOrchestratorError(
      safeFailureCode(error),
      'Foundation staging orchestration failed after bookmark capture.',
      { rollbackBookmark: bookmark },
    )
  }
}
