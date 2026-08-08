import { readdir, readFile } from 'node:fs/promises'
import { extname, relative } from 'node:path'

const ROOT = new URL('../src/', import.meta.url)
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

// The frontend intentionally keeps a local `supabase` compatibility facade while
// call sites are migrated incrementally. What must not return to browser runtime
// is the Supabase SDK, Supabase browser credentials, or direct Supabase HTTP use.
const FORBIDDEN_PATTERNS = [
  /(?:from\s+|import\s*\()\s*['"]@supabase\/supabase-js['"]/i,
  /require\(\s*['"]@supabase\/supabase-js['"]\s*\)/i,
  /\bcreateClient\s*\([^\n]*(?:VITE_SUPABASE_|supabase\.co)/i,
  /\bVITE_SUPABASE_(?:URL|ANON_KEY|PUBLISHABLE_KEY|SERVICE_ROLE_KEY)\b/i,
  /https?:\/\/[a-z0-9-]+\.supabase\.co\b/i,
]

async function walk(url, output = []) {
  const entries = await readdir(url, { withFileTypes: true })
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, url)
    if (entry.isDirectory()) await walk(child, output)
    else if (EXTENSIONS.has(extname(entry.name))) output.push(child)
  }
  return output
}

function annotationValue(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

const files = await walk(ROOT)
const violations = []
for (const file of files) {
  const content = await readFile(file, 'utf8')
  const matches = FORBIDDEN_PATTERNS
    .map((pattern) => pattern.exec(content)?.[0] || null)
    .filter(Boolean)
  if (matches.length) {
    violations.push({
      file: relative(new URL('../', ROOT).pathname, file.pathname),
      matches,
    })
  }
}

if (violations.length) {
  console.error('Direct Supabase browser-runtime dependencies remain in frontend source:')
  for (const violation of violations.sort((a, b) => a.file.localeCompare(b.file))) {
    const message = `Forbidden browser Supabase dependency: ${violation.matches.join(', ')}`
    console.error(`- ${violation.file}: ${violation.matches.join(', ')}`)
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.error(`::error file=${annotationValue(violation.file)},title=Direct Supabase runtime dependency::${annotationValue(message)}`)
    }
  }
  process.exit(2)
}

console.log('Frontend runtime has no direct Supabase SDK, credentials, or HTTP dependency.')
