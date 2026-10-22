import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'
import {accountUsage} from '../../scripts/luna/languageBatchBudget.mjs'
const url=process.env.LANGUAGE_PROXY_URL,token=process.env.LANGUAGE_PROXY_TOKEN,ids=process.env.LANG_CASE_IDS
if(!url||!/^https:\/\/luna-language-budget-\d+\.gabrielboalento3004\.workers\.dev$/.test(url)||!token||!ids)throw Error('BUDGETED_LIVE_CONFIGURATION_REQUIRED')
const dir=fileURLToPath(new URL('../../.artifacts/luna-language/',import.meta.url));mkdirSync(dir,{recursive:true})
let stopped=false
async function status(){const r=await fetch(url+'/status',{headers:{authorization:`Bearer ${token}`}});if(!r.ok)throw Error('SHARED_BUDGET_UNAVAILABLE');return r.json()}
export default defineConfig({plugins:[cloudflareTest(async()=>({wrangler:{configPath:'./wrangler.test.jsonc'},miniflare:{d1Databases:['DB','AUTH_DB'],bindings:{LANG_CASE_IDS:ids,TEST_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./migrations',import.meta.url))),TEST_AUTH_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./auth-migrations',import.meta.url)))},serviceBindings:{LIVE_MODEL:async(request:Request)=>{
 const path=new URL(request.url).pathname
 if(path==='/control'){const s=await status();return Response.json({...s,stop:stopped||s.stop})}
 if(path==='/evidence'){const body=await request.json() as {id:number};if(!Number.isInteger(body.id))throw Error('EVIDENCE_ID_INVALID');writeFileSync(dir+'case-'+body.id+'.json',JSON.stringify(body,null,2));return Response.json({ok:true})}
 if(stopped)return Response.json({code:'BATCH_STOPPED'},{status:429})
 try{
  const usage=await accountUsage(),s=await status()
  if(s.stop||usage.day!==s.day||usage.floor>=9000){stopped=true;return Response.json({code:'DAILY_BUDGET_UNAVAILABLE'},{status:429})}
  // Refresh the account floor without resetting existing receipts/reservations.
  if(usage.floor>s.used){const delta=usage.floor-s.used;let r=await fetch(url+'/reserve',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({bound:delta})});if(!r.ok)throw Error('ACCOUNT_FLOOR_RESERVATION_FAILED');const t=await r.json();r=await fetch(url+'/settle',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...t,actual:delta})});if(!r.ok)throw Error('ACCOUNT_FLOOR_SETTLEMENT_FAILED')}
  const r=await fetch(url+'/run',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(await request.json()),signal:AbortSignal.timeout(150000)})
  const body=await r.json();if(!r.ok){stopped=true;writeFileSync(dir+'stop.json',JSON.stringify({status:r.status,code:body.code}));}return Response.json(body,{status:r.status})
 }catch{stopped=true;writeFileSync(dir+'stop.json',JSON.stringify({code:'USAGE_OR_TRANSPORT_UNCERTAIN'}));return Response.json({code:'USAGE_OR_TRANSPORT_UNCERTAIN'},{status:502})}
}}}}))],test:{include:['test/lunaThinkLanguageLive.test.ts'],setupFiles:['./test/applyD1Migrations.ts'],maxWorkers:1,bail:1,retry:0,testTimeout:600000}})
