#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const EVIDENCE_PATH = resolve(REPO_ROOT, '.artifacts/production-rollback/d1-restore.json')
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()
const BOOKMARK = /^[0-9a-f-]{24,}$/i
const UUID = /^[0-9a-f-]{36}$/i

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}

export function validateRollbackInput({ mainDatabaseId, authDatabaseId, mainBookmark, authBookmark }) {
  if (!UUID.test(String(mainDatabaseId || ''))) throw new Error('PRODUCTION_MAIN_DATABASE_ID_INVALID')
  if (!UUID.test(String(authDatabaseId || ''))) throw new Error('PRODUCTION_AUTH_DATABASE_ID_INVALID')
  if (mainDatabaseId === authDatabaseId) throw new Error('PRODUCTION_DATABASE_ID_COLLISION')
  if (!BOOKMARK.test(String(mainBookmark || ''))) throw new Error('PRODUCTION_MAIN_BOOKMARK_INVALID')
  if (!BOOKMARK.test(String(authBookmark || ''))) throw new Error('PRODUCTION_AUTH_BOOKMARK_INVALID')
  return true
}

async function restore(databaseId, bookmark) {
  const accountId = required('CLOUDFLARE_ACCOUNT_ID')
  const token = required('CLOUDFLARE_API_TOKEN')
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/time_travel/restore`)
  url.searchParams.set('bookmark', bookmark)
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success !== true || !payload?.result?.bookmark) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message || entry?.code).filter(Boolean).join(';')
      : `HTTP_${response.status}`
    throw new Error(`D1_TIME_TRAVEL_RESTORE_FAILED:${databaseId}:${detail || response.status}`)
  }
  return payload.result
}

async function restorePair() {
  const input = {
    mainDatabaseId: required('YUISYNC_PRODUCTION_DB_ID'),
    authDatabaseId: required('YUISYNC_PRODUCTION_AUTH_DB_ID'),
    mainBookmark: required('PRODUCTION_MAIN_BOOKMARK'),
    authBookmark: required('PRODUCTION_AUTH_BOOKMARK'),
  }
  validateRollbackInput(input)

  let mainResult
  try {
    mainResult = await restore(input.mainDatabaseId, input.mainBookmark)
    const authResult = await restore(input.authDatabaseId, input.authBookmark)
    const evidence = {
      schema: 'yuisync-production-d1-rollback/v1',
      status: 'restored',
      main: { target_bookmark: input.mainBookmark, result_bookmark: mainResult.bookmark, previous_bookmark: mainResult.previous_bookmark || null },
      auth: { target_bookmark: input.authBookmark, result_bookmark: authResult.bookmark, previous_bookmark: authResult.previous_bookmark || null },
    }
    await mkdir(dirname(EVIDENCE_PATH), { recursive: true })
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`)
    console.log(JSON.stringify({ status: 'restored', main: mainResult.bookmark, auth: authResult.bookmark }))
  } catch (error) {
    if (mainResult?.previous_bookmark) {
      try {
        await restore(input.mainDatabaseId, mainResult.previous_bookmark)
      } catch (compensationError) {
        throw new Error(`D1_ROLLBACK_PARTIAL_AND_COMPENSATION_FAILED:${error instanceof Error ? error.message : String(error)}:${compensationError instanceof Error ? compensationError.message : String(compensationError)}`)
      }
    }
    throw error
  }
}

async function main() {
  if (COMMAND === 'restore-d1') return restorePair()
  throw new Error('Usage: node scripts/migration/production-rollback.mjs restore-d1')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
