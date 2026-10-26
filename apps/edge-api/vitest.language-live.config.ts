import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'
// Real-model battery: local Think/D1 fixtures, GLM through the Workers AI REST
// API of the staging account. It runs until Workers AI refuses for lack of
// daily neurons; the remaining cases are then skipped, never retried.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,ids=process.env.LANG_CASE_IDS
if(account!=='7eb4b696a14fde38c74edde4ebfcd1d9'||!token||!ids)throw Error('LIVE_BATTERY_CONFIGURATION_REQUIRED')
const MODEL='@cf/zai-org/glm-4.7-flash'
const dir=fileURLToPath(new URL('../../.artifacts/luna-language/',import.meta.url));mkdirSync(dir,{recursive:true})
let stopped:string|null=null
async function run(input:Record<string,unknown>){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${MODEL}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...input,stream:false,chat_template_kwargs:{...(input.chat_template_kwargs as object??{}),enable_thinking:false}}),signal:AbortSignal.timeout(150000)})
 const body=await r.json() as {success?:boolean;result?:unknown;errors?:{code?:number;message?:string}[]}
 if(r.ok&&body.success)return Response.json(body.result)
 // 4006: the account used its free daily neurons. Stop the whole battery.
 if(body.errors?.some(e=>e.code===4006||/neurons/i.test(e.message??''))){stopped='DAILY_NEURONS_EXHAUSTED';writeFileSync(dir+'stop.json',JSON.stringify({code:stopped,errors:body.errors}))}
 return Response.json({code:'WORKERS_AI_ERROR',status:r.status,errors:body.errors},{status:r.status>=400?r.status:502})
}
export default defineConfig({plugins:[cloudflareTest(async()=>({wrangler:{configPath:'./wrangler.test.jsonc'},miniflare:{d1Databases:['DB','AUTH_DB'],bindings:{LANG_CASE_IDS:ids,LUNA_INBOX_DEBOUNCE_MS:'1500',TEST_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./migrations',import.meta.url))),TEST_AUTH_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./auth-migrations',import.meta.url)))},serviceBindings:{LIVE_MODEL:async(request:Request)=>{
 const path=new URL(request.url).pathname
 if(path==='/control')return Response.json({stop:Boolean(stopped),reason:stopped})
 if(path==='/evidence'){const body=await request.json() as {id:number};if(!Number.isInteger(body.id))throw Error('EVIDENCE_ID_INVALID');writeFileSync(dir+'case-'+body.id+'.json',JSON.stringify(body,null,2));return Response.json({ok:true})}
 if(stopped)return Response.json({code:stopped},{status:429})
 const job=await request.json() as {model:string;input:Record<string,unknown>}
 if(job.model!==MODEL)return Response.json({code:'MODEL_INVALID'},{status:400})
 try{return await run(job.input)}catch(error){return Response.json({code:'WORKERS_AI_TRANSPORT',message:String(error)},{status:502})}
}}}}))],test:{include:['test/lunaThinkLanguageLive.test.ts'],setupFiles:['./test/applyD1Migrations.ts'],maxWorkers:1,bail:0,retry:0,testTimeout:600000}})
