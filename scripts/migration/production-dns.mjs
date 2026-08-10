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
    blockers: exact.filter((record) => record?.type !== 'CNAME'),
  }
}

function backupRecord(record) {
  return {
    type: 'CNAME',
    name: DOMAIN,
    content: String(record?.content || ''),
    ttl: Number(record?.ttl || 1),
    proxied: Boolean(record?.proxied),
  }
}

async function backupAndClear() {
  const activeZone = await zone()
  const records = await apexRecords(activeZone.id)
  const { cnames, blockers } = classifyApexRecords(records)
  if (blockers.length) {
    throw new Error(`PRODUCTION_DOMAIN_DNS_BLOCKED:${blockers.map((row) => row?.type || 'unknown').join(',')}`)
  }
  if (cnames.some((record) => !record?.id || !record?.content)) throw new Error('PRODUCTION_CNAME_INVALID')

  const backup = {
    schema: 'yuisync-production-dns-backup/v1',
    zone_id: activeZone.id,
    hostname: DOMAIN,
    records: cnames.map(backupRecord),
  }
  await mkdir(dirname(BACKUP_PATH), { recursive: true })
  await writeFile(BACKUP_PATH, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 })

  for (const record of cnames) {
    await cf(`/zones/${encodeURIComponent(activeZone.id)}/dns_records/${encodeURIComponent(String(record.id))}`, { method: 'DELETE' })
  }
  console.log(JSON.stringify({ status: 'backed-up-and-cleared', hostname: DOMAIN, removed_cnames: cnames.length }))
}

async function restore() {
  let backup
  try {
    backup = JSON.parse(await readFile(BACKUP_PATH, 'utf8'))
  } catch (error) {
    throw new Error(`PRODUCTION_DNS_BACKUP_REQUIRED:${error instanceof Error ? error.message : String(error)}`)
  }
  if (backup?.schema !== 'yuisync-production-dns-backup/v1' || backup?.hostname !== DOMAIN || !backup?.zone_id) {
    throw new Error('PRODUCTION_DNS_BACKUP_INVALID')
  }

  const existing = await apexRecords(String(backup.zone_id))
  if (existing.length) {
    const expected = new Set((backup.records || []).map((record) => `${record.type}:${record.content}:${Boolean(record.proxied)}`))
    const actual = new Set(existing.map((record) => `${record.type}:${record.content}:${Boolean(record.proxied)}`))
    if (expected.size === actual.size && [...expected].every((value) => actual.has(value))) {
      console.log(JSON.stringify({ status: 'dns-already-restored', hostname: DOMAIN }))
      return
    }
    throw new Error(`PRODUCTION_DNS_RESTORE_CONFLICT:${existing.map((record) => record?.type || 'unknown').join(',')}`)
  }

  for (const record of backup.records || []) {
    await cf(`/zones/${encodeURIComponent(String(backup.zone_id))}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    })
  }
  console.log(JSON.stringify({ status: 'dns-restored', hostname: DOMAIN, restored_cnames: (backup.records || []).length }))
}

async function inspect() {
  const activeZone = await zone()
  const records = await apexRecords(activeZone.id)
  const { cnames, blockers } = classifyApexRecords(records)
  console.log(JSON.stringify({
    status: 'inspected',
    hostname: DOMAIN,
    zone_id: activeZone.id,
    cnames: cnames.map(backupRecord),
    blocker_types: blockers.map((record) => record?.type || 'unknown'),
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
