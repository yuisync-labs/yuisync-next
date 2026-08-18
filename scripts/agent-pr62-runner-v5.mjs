import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

let script = fs.readFileSync('scripts/agent-pr62-codemod-v3.mjs', 'utf8')
const start = script.indexOf("if (/\\bsupabase\\b|")
const next = script.indexOf("if (/first_appointment_at|recurring_appointments_created_at/", start)
if (start < 0 || next < 0) throw new Error('Could not isolate PR62 inline primitive guard')
script = script.slice(0, start) + script.slice(next)
const file = '/tmp/agent-pr62-codemod-v5.mjs'
fs.writeFileSync(file, script)
await import(pathToFileURL(file).href)
