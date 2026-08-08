import { readdir, readFile } from 'node:fs/promises'
import { extname, relative } from 'node:path'

const ROOT = new URL('../src/', import.meta.url)
const MANIFEST = new URL('../apps/edge-api/src/compatSurface.json', import.meta.url)
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const strict = process.argv.includes('--strict')

async function walk(url, output = []) {
  const entries = await readdir(url, { withFileTypes: true })
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, url)
    if (entry.isDirectory()) await walk(child, output)
    else if (EXTENSIONS.has(extname(entry.name))) output.push(child)
  }
  return output
}

function literalCalls(content, method) {
  const values = new Set()
  const pattern = new RegExp(`\\.${method}\\(\\s*['\"]([^'\"]+)['\"]`, 'g')
  for (const match of content.matchAll(pattern)) values.add(match[1])
  return values
}

function intersection(left, right) {
  return [...left].filter((value) => right.has(value)).sort()
}

function printEntries(title, names, refs, writer = console.error) {
  if (!names.length) return
  writer(title)
  for (const name of names) writer(`- ${name}: ${(refs.get(name) || []).join(', ')}`)
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const supportedTables = new Set(Array.isArray(manifest.tables) ? manifest.tables : [])
const supportedRpcs = new Set(Array.isArray(manifest.rpcs) ? manifest.rpcs : [])
const deferredTables = new Set(Array.isArray(manifest.deferredTables) ? manifest.deferredTables : [])
const deferredRpcs = new Set(Array.isArray(manifest.deferredRpcs) ? manifest.deferredRpcs : [])
if (!supportedTables.size) throw new Error('Compatibility table manifest is empty.')

const duplicateTables = intersection(supportedTables, deferredTables)
const duplicateRpcs = intersection(supportedRpcs, deferredRpcs)
if (duplicateTables.length || duplicateRpcs.length) {
  if (duplicateTables.length) console.error(`Tables cannot be both supported and deferred: ${duplicateTables.join(', ')}`)
  if (duplicateRpcs.length) console.error(`RPCs cannot be both supported and deferred: ${duplicateRpcs.join(', ')}`)
  process.exit(2)
}

const tables = new Map()
const rpcs = new Map()
for (const file of await walk(ROOT)) {
  const content = await readFile(file, 'utf8')
  const path = relative(new URL('../', ROOT).pathname, file.pathname)
  for (const value of literalCalls(content, 'from')) {
    const refs = tables.get(value) || []
    refs.push(path)
    tables.set(value, refs)
  }
  for (const value of literalCalls(content, 'rpc')) {
    const refs = rpcs.get(value) || []
    refs.push(path)
    rpcs.set(value, refs)
  }
}

const untrackedTables = [...tables.keys()]
  .filter((name) => !supportedTables.has(name) && !deferredTables.has(name))
  .sort()
const untrackedRpcs = [...rpcs.keys()]
  .filter((name) => !supportedRpcs.has(name) && !deferredRpcs.has(name))
  .sort()
const activeDeferredTables = [...deferredTables].filter((name) => tables.has(name)).sort()
const activeDeferredRpcs = [...deferredRpcs].filter((name) => rpcs.has(name)).sort()
const staleDeferredTables = [...deferredTables].filter((name) => !tables.has(name)).sort()
const staleDeferredRpcs = [...deferredRpcs].filter((name) => !rpcs.has(name)).sort()

console.log(`Frontend compatibility surface: ${tables.size} tables, ${rpcs.size} RPCs.`)

if (untrackedTables.length || untrackedRpcs.length) {
  printEntries('Frontend tables are neither implemented nor explicitly deferred:', untrackedTables, tables)
  printEntries('Frontend RPCs are neither implemented nor explicitly deferred:', untrackedRpcs, rpcs)
  process.exit(2)
}

if (activeDeferredTables.length || activeDeferredRpcs.length) {
  printEntries('Tracked Edge table gaps still referenced by the frontend:', activeDeferredTables, tables, console.warn)
  printEntries('Tracked Edge RPC gaps still referenced by the frontend:', activeDeferredRpcs, rpcs, console.warn)
}

if (staleDeferredTables.length || staleDeferredRpcs.length) {
  if (staleDeferredTables.length) console.warn(`Deferred tables no longer referenced: ${staleDeferredTables.join(', ')}`)
  if (staleDeferredRpcs.length) console.warn(`Deferred RPCs no longer referenced: ${staleDeferredRpcs.join(', ')}`)
}

if (strict && (activeDeferredTables.length || activeDeferredRpcs.length)) {
  console.error('Strict Edge compatibility check failed: staging cannot deploy while deferred compatibility gaps remain.')
  process.exit(3)
}

if (activeDeferredTables.length || activeDeferredRpcs.length) {
  console.log('All frontend data calls are either implemented or explicitly tracked as deferred. Strict staging readiness is still blocked.')
} else {
  console.log('Every literal frontend data call is covered by the implemented Edge compatibility manifest.')
}
