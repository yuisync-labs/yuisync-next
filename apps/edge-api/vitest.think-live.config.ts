import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'
const dir=fileURLToPath(new URL('../../.wrangler/think-live-bridge/',import.meta.url))
mkdirSync(dir,{recursive:true})
let index=0
export default defineConfig({
 plugins:[cloudflareTest(async()=>({wrangler:{configPath:'./wrangler.test.jsonc'},miniflare:{d1Databases:['DB','AUTH_DB'],bindings:{LIVE_IDS:process.env.THINK_LIVE_IDS??'',LIVE_FROM:Number(process.env.THINK_LIVE_FROM??1),LIVE_TO:Number(process.env.THINK_LIVE_TO??30),TEST_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./migrations',import.meta.url))),TEST_AUTH_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./auth-migrations',import.meta.url)))},serviceBindings:{LIVE_MODEL:async(request:Request)=>{
  if(new URL(request.url).pathname==='/control')return Response.json(existsSync(dir+'control.json')?JSON.parse(readFileSync(dir+'control.json','utf8')):{stop:false})
  if(new URL(request.url).pathname==='/evidence'){const body=await request.json() as {id:number};writeFileSync(dir+'case-'+body.id+'.json',JSON.stringify(body));return Response.json({ok:true})}
  const id=++index,body=await request.json()
  writeFileSync(dir+'request-'+id+'.json',JSON.stringify({id,body}))
  const deadline=Date.now()+600000
  while(!existsSync(dir+'response-'+id+'.json')){if(Date.now()>deadline)return Response.json({error:'BRIDGE_TIMEOUT'},{status:504});await delay(100)}
  const response=JSON.parse(readFileSync(dir+'response-'+id+'.json','utf8'))
  return Response.json(response.body,{status:response.status})
 }}}}))],
 test:{include:['test/lunaThinkLive.test.ts','test/lunaThinkLiveMatrix.test.ts'],setupFiles:['./test/applyD1Migrations.ts'],maxWorkers:1,testTimeout:1200000},
})
