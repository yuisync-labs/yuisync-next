import {fileURLToPath} from 'node:url'
import {cloudflareTest,readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'
export default defineConfig({plugins:[cloudflareTest(async()=>({wrangler:{configPath:'./wrangler.test.jsonc'},miniflare:{d1Databases:['DB','AUTH_DB'],bindings:{TEST_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./migrations',import.meta.url))),TEST_AUTH_MIGRATIONS:await readD1Migrations(fileURLToPath(new URL('./auth-migrations',import.meta.url)))},serviceBindings:{LIVE_MODEL:async(request:Request)=>{
 const path=new URL(request.url).pathname
 if(path==='/evidence')return Response.json({ok:true})
 if(path==='/control')return Response.json({stop:false})
 // Purely local provider fixture: no network or Workers AI binding.
 return Response.json({response:'Pode me dizer como posso ajudar?',usage:{prompt_tokens:10,completion_tokens:8}})
}}}}))],test:{include:['test/lunaLanguageColdFixture.test.ts'],setupFiles:['./test/applyD1Migrations.ts'],maxWorkers:1,retry:0,testTimeout:60000}})
