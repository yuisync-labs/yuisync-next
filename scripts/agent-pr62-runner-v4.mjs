import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

let script = fs.readFileSync('scripts/agent-pr62-codemod-v3.mjs', 'utf8')
const before = "if (/\\bsupabase\\b|runWithTenantFallback|applyTenantFilter|\\.rpc\\(|\\.from\\(|message\\.includes\\(/.test(s)) {"
const after = "if (/\\bsupabase\\b|runWithTenantFallback|applyTenantFilter|supabase\\.rpc\\(|supabase\\.from\\(|message\\.includes\\(/.test(s)) {"
if (!script.includes(before)) throw new Error('PR62 final guard target not found')
script = script.replace(before, after)
const file = '/tmp/agent-pr62-codemod-v4.mjs'
fs.writeFileSync(file, script)
await import(pathToFileURL(file).href)
