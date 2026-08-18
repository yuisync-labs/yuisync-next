import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = 'src'
const BASELINE_PATH = 'docs/migration/frontend-compat-surface.json'
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full.replaceAll('\\', '/')] : []
    })
}

function count(source, pattern) {
  return source.match(pattern)?.length || 0
}

function inventory() {
  const surface = {}
  for (const file of sourceFiles(ROOT)) {
    const source = fs.readFileSync(file, 'utf8')
    if (!/\bsupabase\b/.test(source)) continue
    const normalized = source.replace(/\bArray\.from\s*\(/g, 'Array_from(')
    const from = count(normalized, /\.from\s*\(/g)
    const rpc = count(normalized, /\.rpc\s*\(/g)
    if (!from && !rpc) continue
    surface[file] = { from, rpc }
  }
  return Object.fromEntries(Object.entries(surface).sort(([left], [right]) => left.localeCompare(right)))
}

function document(surface) {
  const totals = Object.values(surface).reduce((acc, entry) => ({
    from: acc.from + entry.from,
    rpc: acc.rpc + entry.rpc,
  }), { from: 0, rpc: 0 })
  return {
    version: 1,
    policy: 'frontend-supabase-compat-ratchet',
    generated_from: 'src/**/*.{js,jsx,ts,tsx}',
    totals,
    files: surface,
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function previousBaseline(base) {
  if (!base) return null
  try {
    const raw = execFileSync('git', ['show', `${base}:${BASELINE_PATH}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function assertNoIncrease(current, previous) {
  if (!previous?.files) return
  const violations = []
  for (const [file, counts] of Object.entries(current.files)) {
    const before = previous.files[file] || { from: 0, rpc: 0 }
    for (const metric of ['from', 'rpc']) {
      if (Number(counts[metric] || 0) > Number(before[metric] || 0)) {
        violations.push(`${file}: ${metric} ${before[metric] || 0} -> ${counts[metric] || 0}`)
      }
    }
  }
  if (violations.length) {
    throw new Error(`Frontend compatibility debt cannot increase:\n${violations.join('\n')}`)
  }
}

function selfVerifyRatchet() {
  const previous = { files: { 'src/a.js': { from: 2, rpc: 1 } } }
  assertNoIncrease({ files: { 'src/a.js': { from: 1, rpc: 1 } } }, previous)

  for (const candidate of [
    { files: { 'src/a.js': { from: 3, rpc: 1 } } },
    { files: { 'src/a.js': { from: 2, rpc: 2 } } },
    { files: { 'src/a.js': { from: 2, rpc: 1 }, 'src/new.js': { from: 1, rpc: 0 } } },
  ]) {
    let rejected = false
    try {
      assertNoIncrease(candidate, previous)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Frontend compatibility ratchet self-check failed to reject an increase.')
  }
}

const write = process.argv.includes('--write')
const baseIndex = process.argv.indexOf('--base')
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : ''
const current = document(inventory())

if (write) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Wrote ${BASELINE_PATH}: ${current.totals.from} .from() / ${current.totals.rpc} .rpc() across ${Object.keys(current.files).length} files.`)
  process.exit(0)
}

selfVerifyRatchet()

if (!fs.existsSync(BASELINE_PATH)) {
  throw new Error(`Missing compatibility baseline: ${BASELINE_PATH}`)
}
const committed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
if (!same(current, committed)) {
  throw new Error(`Frontend compatibility inventory drifted. Run: node ${process.argv[1]} --write\nExpected totals ${JSON.stringify(committed.totals)}, actual ${JSON.stringify(current.totals)}.`)
}

assertNoIncrease(committed, previousBaseline(base))
console.log(`Frontend compat ratchet OK: ${current.totals.from} .from() / ${current.totals.rpc} .rpc() across ${Object.keys(current.files).length} files; increases are forbidden.`)
