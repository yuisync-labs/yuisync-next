import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const ROOT = new URL('../src/', import.meta.url)
const EXTENSIONS = new Set(['.js','.jsx','.ts','.tsx'])
const PATTERNS = [
  /\bsupabase\b/i,
  /@supabase\//i,
  /VITE_SUPABASE_/i,
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

const files = await walk(ROOT)
const violations = []
for (const file of files) {
  const content = await readFile(file, 'utf8')
  if (PATTERNS.some((pattern) => pattern.test(content))) {
    violations.push(relative(new URL('../', ROOT).pathname, file.pathname))
  }
}

if (violations.length) {
  console.error('Runtime Supabase references remain in frontend source:')
  for (const file of violations.sort()) console.error(`- ${file}`)
  process.exit(2)
}

console.log('Frontend runtime has no Supabase references.')
