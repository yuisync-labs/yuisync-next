import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const edgeRoot = path.join(root, 'apps', 'edge-api', 'src')
const frontendApi = path.join(root, 'src', 'lib', 'api.js')

const forbiddenEdgeTokens = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TENANT_ID',
  'WHATSAPP_MODULE_ID',
]

async function filesUnder(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesUnder(full))
    else if (entry.isFile() && /\.(?:ts|js|mjs)$/.test(entry.name)) result.push(full)
  }
  return result
}

const violations = []
for (const file of await filesUnder(edgeRoot)) {
  const content = await readFile(file, 'utf8')
  for (const token of forbiddenEdgeTokens) {
    if (content.includes(token)) violations.push(`${path.relative(root, file)} contains ${token}`)
  }
}

const frontend = await readFile(frontendApi, 'utf8')
if (frontend.includes('integration=meta-whatsapp')) {
  violations.push('src/lib/api.js still routes Meta WhatsApp review through the legacy integration handler')
}
if (/VITE_[A-Z0-9_]*(?:WHATSAPP|META)[A-Z0-9_]*(?:SECRET|TOKEN)/.test(frontend)) {
  violations.push('src/lib/api.js contains a public VITE_ WhatsApp/Meta secret or token reference')
}

if (violations.length) {
  console.error('WhatsApp Cloudflare boundary check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('WhatsApp Cloudflare boundary check passed.')
