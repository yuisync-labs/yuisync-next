import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
const request=JSON.parse(await readFile('.github/luna-language-request.json','utf8'))
const catalogue=JSON.parse(await readFile('docs/luna-think-language-cases.json','utf8'))
const ids=request.cases,root=resolve('.artifacts/luna-language'),day=new Date().toISOString().slice(0,10)
if(!Array.isArray(ids)||!ids.length||ids.length>60||new Set(ids).size!==ids.length||ids.some(id=>!catalogue.cases.some(c=>c.id===id)))throw Error('INVALID_LANGUAGE_QUEUE')
await mkdir(root,{recursive:true})
const summary={day,requested:ids,batches:[],stopReason:null};let failed=false
function run(command,args,env,cwd=process.cwd()){const r=spawnSync(command,args,{cwd,env,stdio:'inherit'});return r.status??1}
for(let offset=0;offset<ids.length;offset+=3){
 if(new Date().toISOString().slice(0,10)!==day){summary.stopReason='UTC_DAY_CHANGED';break}
 const index=String(offset/3+1).padStart(2,'0'),cases=ids.slice(offset,offset+3),env={...process.env,LANGUAGE_BATCH_INDEX:index,LANG_CASE_IDS:cases.join(',')}
 const out=resolve(root,'batch-'+index),batch={index,cases,prepared:false,testExit:null,cleanupExit:null}
 summary.batches.push(batch)
 console.log(JSON.stringify({event:'language.queue.batch',index,cases}))
 try{
  const prepared=run(process.execPath,['scripts/luna/runLanguageBatch.mjs','prepare'],env)
  batch.prepared=prepared===0
  if(prepared!==0){summary.stopReason='BUDGET_PREFLIGHT_FAILED';failed=true}
  else{
   const m=JSON.parse(await readFile('.wrangler/luna-language-run/private.json','utf8'))
   batch.testExit=run('npx',['vitest','run','--config','vitest.language-live.config.ts'],{...env,LANGUAGE_PROXY_URL:m.url,LANGUAGE_PROXY_TOKEN:m.token},resolve('apps/edge-api'))
   if(batch.testExit!==0)failed=true // functional failure does not stop independent scenarios
  }
 }finally{
  batch.cleanupExit=run(process.execPath,['scripts/luna/runLanguageBatch.mjs','finish'],env)
  if(batch.cleanupExit!==0){summary.stopReason='BUDGET_OR_CLEANUP_REQUIRES_REVIEW';failed=true}
  if(existsSync(resolve(out,'stop.json'))){summary.stopReason='INFERENCE_BUDGET_OR_USAGE_UNCERTAIN';failed=true}
  if(existsSync(resolve(out,'budget-report.json')))batch.budget=JSON.parse(await readFile(resolve(out,'budget-report.json'),'utf8'))
  await writeFile(resolve(root,'queue-report.json'),JSON.stringify(summary,null,2))
 }
 if(summary.stopReason)break
}
await writeFile(resolve(root,'queue-report.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({event:'language.queue.finished',batches:summary.batches.length,stopReason:summary.stopReason}))
if(failed||summary.stopReason)process.exitCode=1
