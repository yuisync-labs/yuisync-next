import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const sourcePath = 'scripts/agent-pr62-codemod.mjs'
let script = fs.readFileSync(sourcePath, 'utf8')
const target = "  const runScoped = useMemo(() => (runner) => runWithTenantFallback(activeTenantId, runner), [activeTenantId])\\n"

for (const label of ['modal scoped runner', 'page scoped runner']) {
  const block = `replaceOnce(\n  \"${target.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}\",\n  '',\n  '${label}',\n)`
  if (!script.includes(block)) throw new Error(`Could not patch ${label}`)
  script = script.replace(block, `source = source.replace(\"${target.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}\", '')`)
}

const patchedPath = '/tmp/agent-pr62-codemod-patched.mjs'
fs.writeFileSync(patchedPath, script)
await import(pathToFileURL(patchedPath).href)
