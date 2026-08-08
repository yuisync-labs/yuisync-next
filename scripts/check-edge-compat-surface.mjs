import { readdir, readFile } from 'node:fs/promises'
import { extname, relative } from 'node:path'

const ROOT = new URL('../src/', import.meta.url)
const MANIFEST = new URL('../apps/edge-api/src/compatSurface.json', import.meta.url)
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

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

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const supportedTables = new Set(Array.isArray(manifest.tables) ? manifest.tables : [])
const supportedRpcs = new Set(Array.isArray(manifest.rpcs) ? manifest.rpcs : [])
if (!supportedTables.size) throw new Error('Compatibility table manifest is empty.')

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

const unsupportedTables = [...tables.keys()].filter((name) => !supportedTables.has(name)).sort()
const unsupportedRpcs = [...rpcs.keys()].filter((name) => !supportedRpcs.has(name)).sort()

console.log(`Frontend compatibility surface: ${tables.size} tables, ${rpcs.size} RPCs.`)
if (unsupportedTables.length || unsupportedRpcs.length) {
  if (unsupportedTables.length) {
    console.error('Frontend tables missing from the Edge compatibility manifest:')
    for (const name of unsupportedTables) console.error(`- ${name}: ${(tables.get(name) || []).join(', ')}`)
  }
  if (unsupportedRpcs.length) {
    console.error('Frontend RPCs missing from the Edge compatibility manifest:')
    for (const name of unsupportedRpcs) console.error(`- ${name}: ${(rpcs.get(name) || []).join(', ')}`)
  }
  process.exit(2)
}

console.log('Every literal frontend data call is covered by the Edge compatibility manifest.')
