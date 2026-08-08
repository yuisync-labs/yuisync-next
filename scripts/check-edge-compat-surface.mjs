import { readdir, readFile } from 'node:fs/promises'
import { extname, relative } from 'node:path'

const ROOT = new URL('../src/', import.meta.url)
const COMPAT_API = new URL('../apps/edge-api/src/compatApi.ts', import.meta.url)
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

const compatSource = await readFile(COMPAT_API, 'utf8')
const tableStart = compatSource.indexOf('const TABLES:')
const tableEnd = compatSource.indexOf('\nfunction json(', tableStart)
if (tableStart < 0 || tableEnd < 0) throw new Error('Could not locate compatibility table registry.')
const tableRegistry = compatSource.slice(tableStart, tableEnd)

const rpcMarker = "const allowed = new Set(["
const rpcStart = compatSource.indexOf(rpcMarker)
const rpcEnd = compatSource.indexOf('])', rpcStart)
if (rpcStart < 0 || rpcEnd < 0) throw new Error('Could not locate compatibility RPC registry.')
const rpcRegistry = compatSource.slice(rpcStart, rpcEnd + 2)

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

const unsupportedTables = [...tables.keys()].filter((name) => !new RegExp(`\\n\\s*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*:`).test(tableRegistry)).sort()
const unsupportedRpcs = [...rpcs.keys()].filter((name) => !rpcRegistry.includes(`'${name}'`) && !rpcRegistry.includes(`\"${name}\"`)).sort()

console.log(`Frontend compatibility surface: ${tables.size} tables, ${rpcs.size} RPCs.`)
if (unsupportedTables.length || unsupportedRpcs.length) {
  if (unsupportedTables.length) {
    console.error('Frontend tables missing from the Edge compatibility registry:')
    for (const name of unsupportedTables) console.error(`- ${name}: ${(tables.get(name) || []).join(', ')}`)
  }
  if (unsupportedRpcs.length) {
    console.error('Frontend RPCs missing from the Edge compatibility registry:')
    for (const name of unsupportedRpcs) console.error(`- ${name}: ${(rpcs.get(name) || []).join(', ')}`)
  }
  process.exit(2)
}

console.log('Every literal frontend data call is covered by the Edge compatibility registry.')
