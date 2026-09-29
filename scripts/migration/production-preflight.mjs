#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Wrangler can prepend or append diagnostic text to commands using --json.
// Find the first complete JSON object or array without logging secret names.
export function parseWranglerJson(output, label) {
  const raw = String(output || '')
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '[' && raw[start] !== '{') continue
    const stack = []
    let quoted = false
    let escaped = false
    for (let end = start; end < raw.length; end += 1) {
      const char = raw[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') { quoted = true; continue }
      if (char === '[' || char === '{') stack.push(char)
      if (char === ']' || char === '}') {
        const opening = stack.pop()
        if ((char === ']' && opening !== '[') || (char === '}' && opening !== '{')) break
        if (stack.length === 0) {
          try { return JSON.parse(raw.slice(start, end + 1)) } catch { break }
        }
      }
    }
  }
  throw new Error(`${label}_INVALID_JSON`)
}

function rowsFromD1(output, label) {
  const payload = parseWranglerJson(output, label)
  return (Array.isArray(payload) ? payload : [payload])
    .flatMap((entry) => Array.isArray(entry?.results) ? entry.results : [])
}

export function proveProductionPrerequisites({ secrets, version, auth }) {
  const secretRows = parseWranglerJson(secrets, 'SECRETS')
  if (!Array.isArray(secretRows)) throw new Error('SECRETS_INVALID_SHAPE')
  for (const name of ['BETTER_AUTH_SECRET', 'AUTH_EMAIL_API_KEY', 'AUTH_EMAIL_FROM']) {
    if (!secretRows.some((row) => row?.name === name)) throw new Error(`${name}_REQUIRED`)
  }
  const schemaVersion = Number(rowsFromD1(version, 'VERSION')[0]?.value ?? NaN)
  if (!Number.isInteger(schemaVersion) || schemaVersion < 25 || schemaVersion > 30) {
    throw new Error(`SCHEMA_VERSION_UNSUPPORTED:${schemaVersion}`)
  }
  const tables = rowsFromD1(auth, 'AUTH').map((row) => String(row.name)).sort().join(',')
  if (tables !== 'account,session,user,verification') throw new Error(`AUTH_SCHEMA_INVALID:${tables}`)
  return { schemaVersion, authTables: tables }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === 'normalize-json') {
    let raw = ''
    for await (const chunk of process.stdin) raw += chunk
    console.log(JSON.stringify(parseWranglerJson(raw, 'WRANGLER')))
  } else {
    const result = proveProductionPrerequisites({
      secrets: process.env.SECRETS,
      version: process.env.VERSION,
      auth: process.env.AUTH,
    })
    console.log(`Production preflight passed: schema v${result.schemaVersion}; auth tables verified.`)
  }
}
