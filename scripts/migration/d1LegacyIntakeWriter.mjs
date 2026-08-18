import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWED_ENVIRONMENTS = new Set(['staging', 'production'])
export const D1_SAFE_STATEMENT_MAX_BYTES = 90_000

export class D1LegacyIntakeWriterError extends Error {
  constructor(code, message = 'D1 legacy intake write failed.') {
    super(message)
    this.name = 'D1LegacyIntakeWriterError'
    this.code = code
  }
}

function text(value) { return value == null ? '' : String(value).trim() }
function sql(value) {
  if (value == null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new D1LegacyIntakeWriterError('MIGRATION_SQL_NUMBER_INVALID')
    return String(value)
  }
  return `'${String(value).replaceAll("'", "''")}'`
}
function json(value) { return sql(JSON.stringify(value ?? {})) }

function safeStatement(statement) {
  const bytes = Buffer.byteLength(statement, 'utf8')
  if (bytes > D1_SAFE_STATEMENT_MAX_BYTES) {
    throw new D1LegacyIntakeWriterError('MIGRATION_SQL_STATEMENT_TOO_LARGE', `Migration SQL statement is ${bytes} bytes.`)
  }
  return statement
}

function environmentGate(environment, runId, authorization) {
  if (!ALLOWED_ENVIRONMENTS.has(environment)) throw new D1LegacyIntakeWriterError('MIGRATION_D1_ENVIRONMENT_INVALID')
  if (environment === 'production' && authorization !== `AUTHORIZE_MIGRATION_RUN:${runId}`) {
    throw new D1LegacyIntakeWriterError('MIGRATION_PRODUCTION_NOT_AUTHORIZED')
  }
}

function runStatement(run) {
  return safeStatement(`INSERT INTO migration_runs(id,source_system,source_ref,tenant_id,module_id,mode,status,source_snapshot_at_ms,source_schema_fingerprint,parent_run_id,details_json,started_at_ms,completed_at_ms,created_at_ms,updated_at_ms) VALUES(${sql(run.id)},${sql(run.source_system)},${sql(run.source_ref)},${sql(run.tenant_id)},${sql(run.module_id)},${sql(run.mode || 'bulk')},${sql(run.status || 'prepared')},${sql(run.source_snapshot_at_ms)},${sql(run.source_schema_fingerprint)},${sql(run.parent_run_id)},${json(run.details || {})},${sql(run.started_at_ms)},${sql(run.completed_at_ms)},${sql(run.created_at_ms)},${sql(run.updated_at_ms)}) ON CONFLICT(id) DO UPDATE SET status=excluded.status,details_json=excluded.details_json,started_at_ms=COALESCE(migration_runs.started_at_ms,excluded.started_at_ms),completed_at_ms=excluded.completed_at_ms,updated_at_ms=excluded.updated_at_ms;`)
}

function clearChunksStatement(record) {
  return safeStatement(`DELETE FROM migration_source_payload_chunks WHERE run_id=${sql(record.run_id)} AND source_table=${sql(record.source_table)} AND source_key=${sql(record.source_key)};`)
}
function clearSecretsStatement(record) {
  return safeStatement(`DELETE FROM migration_secret_vault WHERE run_id=${sql(record.run_id)} AND source_table=${sql(record.source_table)} AND source_key=${sql(record.source_key)};`)
}

function recordStatement(record) {
  return safeStatement(`INSERT INTO migration_source_records(run_id,source_table,source_key,tenant_id,module_id,disposition,data_class,destination_hint,payload_mode,payload_encoding,payload_json,payload_bytes,payload_chunk_count,payload_checksum,secret_names_json,source_created_at_ms,source_updated_at_ms,staged_at_ms) VALUES(${sql(record.run_id)},${sql(record.source_table)},${sql(record.source_key)},${sql(record.tenant_id)},${sql(record.module_id)},${sql(record.disposition)},${sql(record.data_class)},${sql(record.destination_hint)},${sql(record.payload_mode)},${sql(record.payload_encoding)},${sql(record.payload_json)},${sql(record.payload_bytes)},${sql(record.payload_chunk_count)},${sql(record.payload_checksum)},${sql(record.secret_names_json || '[]')},${sql(record.source_created_at_ms)},${sql(record.source_updated_at_ms)},${sql(record.staged_at_ms)}) ON CONFLICT(run_id,source_table,source_key) DO UPDATE SET module_id=excluded.module_id,disposition=excluded.disposition,data_class=excluded.data_class,destination_hint=excluded.destination_hint,payload_mode=excluded.payload_mode,payload_encoding=excluded.payload_encoding,payload_json=excluded.payload_json,payload_bytes=excluded.payload_bytes,payload_chunk_count=excluded.payload_chunk_count,payload_checksum=excluded.payload_checksum,secret_names_json=excluded.secret_names_json,source_created_at_ms=excluded.source_created_at_ms,source_updated_at_ms=excluded.source_updated_at_ms,staged_at_ms=excluded.staged_at_ms;`)
}

function chunkStatement(chunk) {
  return safeStatement(`INSERT INTO migration_source_payload_chunks(run_id,source_table,source_key,chunk_index,payload_chunk_b64,chunk_bytes,created_at_ms) VALUES(${sql(chunk.run_id)},${sql(chunk.source_table)},${sql(chunk.source_key)},${sql(chunk.chunk_index)},${sql(chunk.payload_chunk_b64)},${sql(chunk.chunk_bytes)},${sql(chunk.created_at_ms)}) ON CONFLICT(run_id,source_table,source_key,chunk_index) DO UPDATE SET payload_chunk_b64=excluded.payload_chunk_b64,chunk_bytes=excluded.chunk_bytes,created_at_ms=excluded.created_at_ms;`)
}

function secretStatement(secret) {
  return safeStatement(`INSERT INTO migration_secret_vault(run_id,source_table,source_key,secret_path,tenant_id,destination_hint,ciphertext_b64,iv_b64,auth_tag_b64,secret_fingerprint,key_version,status,created_at_ms,updated_at_ms) VALUES(${sql(secret.run_id)},${sql(secret.source_table)},${sql(secret.source_key)},${sql(secret.secret_path)},${sql(secret.tenant_id)},${sql(secret.destination_hint)},${sql(secret.ciphertext_b64)},${sql(secret.iv_b64)},${sql(secret.auth_tag_b64)},${sql(secret.secret_fingerprint)},${sql(secret.key_version)},${sql(secret.status || 'sealed')},${sql(secret.created_at_ms)},${sql(secret.updated_at_ms)}) ON CONFLICT(run_id,source_table,source_key,secret_path) DO UPDATE SET ciphertext_b64=excluded.ciphertext_b64,iv_b64=excluded.iv_b64,auth_tag_b64=excluded.auth_tag_b64,secret_fingerprint=excluded.secret_fingerprint,key_version=excluded.key_version,status=excluded.status,updated_at_ms=excluded.updated_at_ms;`)
}

function checkpointStatement(runId, checkpoint, now) {
  return safeStatement(`INSERT INTO migration_table_checkpoints(run_id,source_table,source_row_count,staged_row_count,source_checksum,staged_checksum,cursor_json,status,updated_at_ms) VALUES(${sql(runId)},${sql(checkpoint.source_table)},${sql(checkpoint.source_row_count || 0)},${sql(checkpoint.staged_row_count || 0)},${sql(checkpoint.source_checksum)},${sql(checkpoint.staged_checksum)},${json(checkpoint.cursor || {})},${sql(checkpoint.status || 'pending')},${sql(now)}) ON CONFLICT(run_id,source_table) DO UPDATE SET source_row_count=excluded.source_row_count,staged_row_count=excluded.staged_row_count,source_checksum=excluded.source_checksum,staged_checksum=excluded.staged_checksum,cursor_json=excluded.cursor_json,status=excluded.status,updated_at_ms=excluded.updated_at_ms;`)
}

export function buildLegacyIntakeSql({ run = null, records = [], chunks = [], secrets = [], checkpoints = [], now = Date.now() } = {}) {
  if (![records, chunks, secrets, checkpoints].every(Array.isArray)) throw new D1LegacyIntakeWriterError('MIGRATION_BATCH_INVALID')
  const runId = text(run?.id || records[0]?.run_id || chunks[0]?.run_id || secrets[0]?.run_id)
  if (!runId) throw new D1LegacyIntakeWriterError('MIGRATION_RUN_REQUIRED')

  const chunksByRecord = new Map()
  for (const chunk of chunks) {
    const key = `${chunk.run_id}\u001f${chunk.source_table}\u001f${chunk.source_key}`
    if (!chunksByRecord.has(key)) chunksByRecord.set(key, [])
    chunksByRecord.get(key).push(chunk)
  }
  const secretsByRecord = new Map()
  for (const secret of secrets) {
    const key = `${secret.run_id}\u001f${secret.source_table}\u001f${secret.source_key}`
    if (!secretsByRecord.has(key)) secretsByRecord.set(key, [])
    secretsByRecord.get(key).push(secret)
  }

  // Wrangler D1 file imports may manage transaction boundaries internally. The
  // writer therefore uses idempotent row-level statements and writes checkpoints
  // last, making interrupted files safely retryable without nested transactions.
  const statements = ['PRAGMA foreign_keys=ON;']
  if (run) statements.push(runStatement(run))
  for (const record of records) {
    const key = `${record.run_id}\u001f${record.source_table}\u001f${record.source_key}`
    const recordChunks = (chunksByRecord.get(key) || []).sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index))
    const recordSecrets = (secretsByRecord.get(key) || []).sort((a, b) => String(a.secret_path).localeCompare(String(b.secret_path), 'en'))
    if (record.payload_mode === 'chunked' && recordChunks.length !== Number(record.payload_chunk_count)) {
      throw new D1LegacyIntakeWriterError('MIGRATION_CHUNK_COUNT_MISMATCH')
    }
    if (record.payload_mode === 'inline' && recordChunks.length !== 0) {
      throw new D1LegacyIntakeWriterError('MIGRATION_INLINE_HAS_CHUNKS')
    }
    statements.push(clearChunksStatement(record), clearSecretsStatement(record), recordStatement(record))
    statements.push(...recordChunks.map(chunkStatement), ...recordSecrets.map(secretStatement))
  }
  statements.push(...checkpoints.map((item) => checkpointStatement(runId, item, now)))
  return `${statements.join('\n')}\n`
}

export function createD1LegacyIntakeWriter({
  execFile = execFileAsync,
  environment = 'staging',
  binding = 'DB',
  configPath = 'apps/edge-api/wrangler.jsonc',
  productionAuthorization = null,
} = {}) {
  if (binding !== 'DB') throw new D1LegacyIntakeWriterError('MIGRATION_D1_BINDING_INVALID')
  const resolvedConfig = resolve(REPO_ROOT, configPath)

  return async function writeBatch(batch) {
    const runId = text(batch?.run?.id || batch?.records?.[0]?.run_id || batch?.chunks?.[0]?.run_id || batch?.secrets?.[0]?.run_id)
    environmentGate(environment, runId, productionAuthorization)
    const sqlText = buildLegacyIntakeSql(batch)
    const directory = await mkdtemp(join(tmpdir(), 'yuisync-migration-'))
    const file = join(directory, 'intake.sql')
    try {
      await writeFile(file, sqlText, { encoding: 'utf8', mode: 0o600 })
      await chmod(file, 0o600)
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      try {
        await execFile(npm, ['exec','--workspace','@yuisync/edge-api','--','wrangler','d1','execute',binding,'--remote','--env',environment,'--config',resolvedConfig,'--file',file], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: process.env,
        })
      } catch {
        throw new D1LegacyIntakeWriterError('MIGRATION_D1_WRITE_FAILED')
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
