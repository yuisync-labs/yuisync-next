import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const ACCOUNT_ID=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim()
const API_TOKEN=String(process.env.CLOUDFLARE_API_TOKEN||'').trim()
const DB_NAME='yuisync-auth-staging'
const CONFIG='apps/edge-api/wrangler.jsonc'
if(!ACCOUNT_ID||!API_TOKEN)throw new Error('Cloudflare credentials are required.')

function npm(){return process.platform==='win32'?'npm.cmd':'npm'}
function listDatabases(){
  const stdout=execFileSync(npm(),['exec','--workspace','@yuisync/edge-api','--','wrangler','d1','list','--json'],{encoding:'utf8',stdio:['ignore','pipe','inherit']})
  const parsed=JSON.parse(stdout);return Array.isArray(parsed)?parsed:(Array.isArray(parsed?.result)?parsed.result:[])
}
async function createDatabase(){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database`,{method:'POST',headers:{authorization:`Bearer ${API_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({name:DB_NAME})})
  const payload=await response.json();if(!response.ok||payload?.success!==true||!payload?.result)throw new Error('AUTH_DB could not be created.')
  return payload.result
}

let db=listDatabases().find((item)=>item?.name===DB_NAME)
if(!db)db=await createDatabase()
const databaseId=String(db.uuid||db.id||'').trim()
if(!/^[a-f0-9-]{36}$/i.test(databaseId))throw new Error('AUTH_DB identifier is invalid.')

const config=JSON.parse(await readFile(CONFIG,'utf8'))
const staging=config?.env?.staging
if(!staging)throw new Error('Staging Wrangler environment is missing.')
const d1=Array.isArray(staging.d1_databases)?staging.d1_databases:[]
const main=d1.filter((item)=>item?.binding!=='AUTH_DB')
main.push({binding:'AUTH_DB',database_name:DB_NAME,database_id:databaseId,migrations_dir:'auth-migrations',migrations_table:'auth_d1_migrations'})
staging.d1_databases=main
staging.vars={...(staging.vars||{}),EDGE_BETTER_AUTH_ENABLED:'true',EDGE_OPERATIONAL_MIGRATION_ENABLED:'false',EDGE_AUTH_MIGRATION_ENABLED:'false'}
await writeFile(CONFIG,`${JSON.stringify(config,null,2)}\n`)
console.log('AUTH_DB binding is configured for staging.')
