import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'
import {openAIBudget} from './liveOpenAIBudget'
// Simulated customers against the real Luna on OpenAI: local Think/D1 fixtures
// with the QuatroPatas catalogue. Luna, the simulated customer and the judge all
// call OpenAI through one budget, and the run stops before passing it.
const model=process.env.LANG_MODEL??'',key=process.env.OPENAI_API_KEY,budgetUsd=Number(process.env.OPENAI_BUDGET_USD),count=process.env.SIM_COUNT
if(!model.startsWith('openai:')||!key||!(budgetUsd>0)||!(Number(count)>0))throw Error('SIMULATOR_CONFIGURATION_REQUIRED')
const dir=fileURLToPath(new URL('../../.artifacts/luna-simulator/',import.meta.url));mkdirSync(dir,{recursive:true})
const budget=openAIBudget(dir,budgetUsd,key)
export default defineConfig({plugins:[cloudflareTest(async()=>({wrangler:{configPath:'./wrangler.test.jsonc'},miniflare:{d1Databases:['DB','AUTH_DB'],bindings:{LANG_CASE_IDS:'',LANG_MODEL:model,SIM_COUNT:count,SIM_SEED:process.env.SIM_SEED??'1',SIM_CUSTOMER_MODEL:process.env.SIM_CUSTOMER_MODEL??'gpt-4.1-mini',LUNA_INBOX_DEBOUNCE_MS:'1500',TEST_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./migrations',import.meta.url))),TEST_AUTH_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./auth-migrations',import.meta.url)))},serviceBindings:{LIVE_MODEL:async(request:Request)=>{
 const path=new URL(request.url).pathname
 if(path==='/control')return Response.json({stop:Boolean(budget.stopped()),reason:budget.stopped()})
 if(path==='/evidence'){const body=await request.json() as {id:number};if(!Number.isInteger(body.id))throw Error('EVIDENCE_ID_INVALID');writeFileSync(dir+'case-'+body.id+'.json',JSON.stringify(body,null,2));return Response.json({ok:true})}
 if(path.startsWith('/openai/'))return budget.call(path.slice(7),await request.text())
 return Response.json({code:'MODEL_INVALID'},{status:400})
}}}}))],test:{include:['test/lunaSimulator.test.ts'],setupFiles:['./test/applyD1Migrations.ts'],maxWorkers:1,bail:0,retry:0,testTimeout:900000}})
