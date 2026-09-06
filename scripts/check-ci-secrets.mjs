import { appendFile } from 'node:fs/promises'

const capability = String(process.argv[2] || 'external').trim()
const names = process.argv.slice(3).map((name) => String(name || '').trim()).filter(Boolean)
if (!names.length) {
  console.error('Usage: node scripts/check-ci-secrets.mjs <capability> <ENV_NAME...>')
  process.exit(1)
}
const missing = names.filter((name) => !String(process.env[name] || '').trim())
const configured = missing.length === 0
const output = process.env.GITHUB_OUTPUT
const summary = process.env.GITHUB_STEP_SUMMARY
if (output) await appendFile(output, `configured=${configured ? 'true' : 'false'}\n`)
const line = configured
  ? `✅ ${capability}: credenciais configuradas; testes externos serão executados.`
  : `⚠️ ${capability}: testes externos não executados. Secrets ausentes: ${missing.join(', ')}.`
if (summary) await appendFile(summary, `${line}\n`)
console.log(line)
// Missing external tests cannot certify a release.
if (!configured) process.exitCode = 1
