import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve('shared/contracts')
const sourceExtensions = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'])
const forbiddenImports = [
  'express',
  '@supabase/',
  'openai',
  '@anthropic-ai/',
  'cloudflare:',
  '@cloudflare/',
]
const forbiddenRelativeSegments = [
  '/server/',
  '/serverless/',
  '/api/',
  '/database/',
  '/supabase/',
  '/src/',
]

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(absolute))
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(absolute)
  }

  return files
}

function importedSpecifiers(source) {
  const matches = source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)
  return [...matches].map((match) => match[2])
}

const violations = []

for (const file of await collectFiles(root)) {
  const source = await readFile(file, 'utf8')
  const relative = path.relative(process.cwd(), file)

  if (/\bprocess\.env\b/.test(source)) {
    violations.push(`${relative}: acesso a process.env não é permitido`)
  }

  for (const specifier of importedSpecifiers(source)) {
    if (forbiddenImports.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
      violations.push(`${relative}: import proibido ${specifier}`)
      continue
    }

    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), specifier).replaceAll('\\', '/')
      if (forbiddenRelativeSegments.some((segment) => resolved.includes(segment))) {
        violations.push(`${relative}: dependência de infraestrutura ${specifier}`)
      }
    }
  }
}

if (violations.length) {
  console.error('Limites de contratos violados:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Limites de contratos preservados.')
