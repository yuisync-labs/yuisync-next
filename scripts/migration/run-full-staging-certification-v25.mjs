#!/usr/bin/env node

import { readFile, unlink, writeFile } from 'node:fs/promises'

const sourceUrl = new URL('./run-full-staging-certification.mjs', import.meta.url)
const generatedUrl = new URL('./.run-full-staging-certification-v25.generated.mjs', import.meta.url)

const source = await readFile(sourceUrl, 'utf8')
const expectedSchemaMarker = "const expectedSchema = '22'"
const checkNameMarker = "await record('schema_v22'"
if (!source.includes(expectedSchemaMarker) || !source.includes(checkNameMarker)) {
  throw new Error('STAGING_CERTIFICATION_V25_PATCH_MARKERS_MISSING')
}

const patched = source
  .replace(expectedSchemaMarker, "const expectedSchema = '25'")
  .replace(checkNameMarker, "await record('schema_v25'")

try {
  await writeFile(generatedUrl, patched, 'utf8')
  await import(`${generatedUrl.href}?run=${Date.now()}`)
} finally {
  await unlink(generatedUrl).catch(() => {})
}
