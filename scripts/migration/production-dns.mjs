#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const BACKUP_PATH = resolve(REPO_ROOT, '.artifacts/production/dns-before.json')
const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
const DOMAIN = 'yuisync.app'
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()

function requireCredentials() {
  if (!ACCOUNT_ID) throw new Error('CLOUDFLARE_ACCOUNT_ID_REQUIRED')
  if (!API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN_REQUIRED')
}

async function cf(path, options = {}) {
  requireCredentials()
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message || entry?.code).filter(Boolean).join(';')
      : `HTTP_${response.status}`
    throw new Error(`CLOUDFLARE_API_FAILED:${path}:${detail || response.status}`)
  }
  return payload
}

async function zone() {
  const payload = await cf(`/zones?name=${encodeURIComponent(DOMAIN)}&status=active&per_page=50`)
  const rows = (payload.result || []).filter((row) => row?.name === DOMAIN && row?.status === 'active')
  if (rows.length !== 1 || !rows[0]?.id) throw new Error(`PRODUCTION_ZONE_NOT_UNIQUE:${rows.length}`)
  return rows[0]
}

async function apexRecords(zoneId) {
  const payload = await cf(`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(DOMAIN)}&per_page=100`)
  return (payload.result || []).filter((record) => record?.name === DOMAIN)
}

export function classifyApexRecords(records) {
  const exact = Array.isArray(records) ? records : []
  return {
    cnames: exact.filter((record) => record?.type === 'CNAME'),
    other: exact.filter((record) => record?.type !== 'CNAME'),
  }
}

export function recordsToClearForCustomDomain(records) {
  // The Workers Custom Domain API rejects hostnames that still have externally
  // managed apex records (A, AAAA, CNAME, etc.). The cutover therefore backs up
  // every exact apex record and clears the exact hostname before attaching.
  return Array.isArray(records) ? [...records] : []
}

function backupRecord(record) {
  const output = {
    type: String(record?.type || ''),
    name: DOMAIN,
    content: String(record?.content || ''),
    ttl: Number(record?.ttl || 1),
  }
  if (typeof record?.proxied === 'boolean') output.proxied = record.proxied
  if (Number.isFinite(Number(record?.priority))) output.priority = Number(record.priority)
  return output
}

function recordKey(record) {
  return [
    String(record?.type || ''),
    String(record?.content || ''),
    String(typeof record?.proxied === 'boolean' ? record.proxied : ''),
    String(Number.isFinite(Number(record?.priority)) ? Number(record.priority) : ''),
  ].join(':')
}

async function backupAndClear() {
  const activeZone = await zone()
  const records = await apexRecords(activeZone.id)
  const toClear = recordsToClearForCustomDomain(records)
  if (records.some((record) => !record?.id || !record?.type || !record?.content)) throw new Error('PRODUCTION_APEX_RECORD_INVALID')

  const backup = {
    schema: 'yuisync-production-dns-backup/v3',
    zone_id: activeZone.id,
    hostname: DOMAIN,
    records: records.map(backupRecord),
    removed_records: toClear.map(backupRecord),
  }
  await mkdir(dirname(BACKUP_PATH), { recursive: true })
  await writeFile(BACKUP_PATH, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 })

  for (const record of toClear) {
    await cf(`/zones/${encodeURIComponent(activeZone.id)}/dns_records/${encodeURIComponent(String(record.id))}`, { method: 'DELETE' })
  }

  const remaining = await apexRecords(activeZone.id)
  if (remaining.length) {
    throw new Error(`PRODUCTION_APEX_NOT_CLEAR:${remaining.map((record) => record?.type || 'unknown').join(',')}`)
  }

  console.log(JSON.stringify({
    status: 'backed-up-and-cleared',
    hostname: DOMAIN,
    removed_records: toClear.length,
    removed_types: toClear.map((record) => record?.type || 'unknown'),
  }))
}

async function restore() {
  let backup
  try {
    backup = JSON.parse(await readFile(BACKUP_PATH, 'utf8'))
  } catch (error) {
    throw new Error(`PRODUCTION_DNS_BACKUP_REQUIRED:${error instanceof Error ? error.message : String(error)}`)
  }
  if (backup?.schema !== 'yuisync-production-dns-backup/v3' || backup?.hostname !== DOMAIN || !backup?.zone_id || !Array.isArray(backup?.records)) {
    throw new Error('PRODUCTION_DNS_BACKUP_INVALID')
  }

  let existing = await apexRecords(String(backup.zone_id))
  const expectedKeys = new Set(backup.records.map(recordKey))
  let existingKeys = new Set(existing.map(recordKey))
  const unexpectedBeforeRestore = [...existingKeys].filter((key) => !expectedKeys.has(key))
  if (unexpectedBeforeRestore.length) {
    throw new Error(`PRODUCTION_DNS_RESTORE_CONFLICT:unexpected=${unexpectedBeforeRestore.length}`)
  }

  for (const record of backup.records) {
    const key = recordKey(record)
    if (existingKeys.has(key)) continue
    await cf(`/zones/${encodeURIComponent(String(backup.zone_id))}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    })
    existingKeys.add(key)
  }

  existing = await apexRecords(String(backup.zone_id))
  const finalKeys = new Set(existing.map(recordKey))
  const missing = [...expectedKeys].filter((key) => !finalKeys.has(key))
  const unexpected = [...finalKeys].filter((key) => !expectedKeys.has(key))
  if (missing.length || unexpected.length) {
    throw new Error(`PRODUCTION_DNS_RESTORE_CONFLICT:missing=${missing.length}:unexpected=${unexpected.length}`)
  }

  console.log(JSON.stringify({ status: 'dns-restored', hostname: DOMAIN, restored_records: backup.records.length }))
}

async function inspect() {
  const activeZone = await zone()
  const records = await apexRecords(activeZone.id)
  const { cnames, other } = classifyApexRecords(records)
  console.log(JSON.stringify({
    status: 'inspected',
    hostname: DOMAIN,
    zone_id: activeZone.id,
    cnames: cnames.map(backupRecord),
    other_types: other.map((record) => record?.type || 'unknown'),
    cutover_record_count: recordsToClearForCustomDomain(records).length,
  }))
}

async function main() {
  if (COMMAND === 'inspect') return inspect()
  if (COMMAND === 'backup-and-clear') return backupAndClear()
  if (COMMAND === 'restore') return restore()
  throw new Error('Usage: node scripts/migration/production-dns.mjs <inspect|backup-and-clear|restore>')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
