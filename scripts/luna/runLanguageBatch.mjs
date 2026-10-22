import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {ACCOUNT,STAGING,accountUsage,batchHeadroom} from './languageBatchBudget.mjs'
const dir=resolve('.wrangler/luna-language-run'),manifest=resolve(dir,'private.json'),out=resolve('.artifacts/luna-language')
const command=process.argv[2]
async function cf(path,options={}){
 const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method:options.method??'GET',headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,...options.headers},body:options.body,signal:AbortSignal.timeout(30000)})
 const result=await r.json();if(!r.ok||!result.success)throw Error('CLOUDFLARE_CONTROL_FAILED_'+r.status);return result.result
}
async function proxy(m,path,body){
 if(path==='/status'&&!body){
  for(let attempt=0;attempt<10;attempt++){
   try{const r=await fetch(m.url+path,{headers:{authorization:`Bearer ${m.token}`},signal:AbortSignal.timeout(10000)});if(r.ok)return await r.json()}catch{}
   await new Promise(resolve=>setTimeout(resolve,1500))
  }
  throw Error('SHARED_BUDGET_UNAVAILABLE')
 }
 const r=await fetch(m.url+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${m.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
 const result=await r.json();if(!r.ok)throw Error(result.code??'SHARED_BUDGET_FAILED');return result
}
async function waitForActivation(m,active){
 for(let attempt=0;attempt<12;attempt++){
  const s=await proxy(m,'/status')
  if(s.active===active&&(!active||(s.day===m.day&&Math.abs(s.spent-(s.used-m.start))<0.00001)))return s
  await new Promise(resolve=>setTimeout(resolve,1500))
 }
 throw Error('BATCH_ACTIVATION_FAILED')
}
function wrangler(args){return execFileSync('npx',['wrangler',...args],{encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','pipe']})}
async function deploy(m,active){
 const config={name:m.name,account_id:ACCOUNT,main:resolve('scripts/luna/languageBudgetProxy.mjs'),compatibility_date:'2026-10-22',workers_dev:true,
  ai:{binding:'AI'},durable_objects:{bindings:[{name:'BUDGET',class_name:'LunaAiBudget',script_name:STAGING}]},
  vars:{BATCH_ACTIVE:String(active),BATCH_DAY:m.day??'',BATCH_START_USED:String(m.start??0),BATCH_MAX:String(m.cap??0)},observability:{enabled:true}}
 await writeFile(m.config,JSON.stringify(config))
 try{wrangler(['deploy','--config',m.config,'--secrets-file',m.secrets])}catch(error){
  // Wrangler 4.147 may successfully upload a new legacy script, then fail its
  // workers/workers subdomain lookup. Verify the actual uploaded bindings and
  // enable only this disposable script through the supported scripts API.
  if(!String(error.stdout).includes('Uploaded '+m.name)||!String(error.stderr).includes('/workers/workers/'+m.name)||!String(error.stderr).includes('10007'))throw Error('TEMP_PROXY_DEPLOY_FAILED')
  const uploaded=await cf(`/accounts/${ACCOUNT}/workers/scripts/${m.name}/settings`)
  const b=name=>uploaded.bindings.find(binding=>binding.name===name)
  if(b('BUDGET')?.namespace_id!==m.namespace||b('AI')?.type!=='ai'||b('TEST_TOKEN')?.type!=='secret_text'||b('BATCH_ACTIVE')?.text!==String(active)||b('BATCH_DAY')?.text!==(m.day??''))throw Error('TEMP_PROXY_UPLOAD_MISMATCH')
  await cf(`/accounts/${ACCOUNT}/workers/scripts/${m.name}/subdomain`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,previews_enabled:false})})
  console.log(JSON.stringify({event:'language.proxy.subdomain.enabled',fallback:'verified-script-api'}))
 }
}
if(command==='prepare'){
 if(process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('AUTOMATIC_RERUN_FORBIDDEN')
 const requested=JSON.parse(await readFile('.github/luna-language-request.json','utf8')).cases
 const catalogue=JSON.parse(await readFile('docs/luna-think-language-cases.json','utf8'))
 if(!Array.isArray(requested)||requested.length<1||requested.length>3||new Set(requested).size!==requested.length||requested.some(id=>!catalogue.cases.some(c=>c.id===id)))throw Error('INVALID_LANGUAGE_BATCH_SELECTION')
 const usage=await accountUsage();if(usage.floor>=9000)throw Error('DAILY_BUDGET_UNAVAILABLE')
 const settings=await cf(`/accounts/${ACCOUNT}/workers/scripts/${STAGING}/settings`)
 const binding=name=>settings.bindings.find(b=>b.name===name)?.text
 if(binding('APP_ENV')!=='staging'||binding('LUNA_RUNTIME')!=='think'||binding('LUNA_AI_DAILY_LIMIT')!=='9000')throw Error('STAGING_RUNTIME_MISMATCH')
 await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true})
 const run=process.env.GITHUB_RUN_ID;if(!/^\d+$/.test(run??''))throw Error('RUN_ID_REQUIRED')
 const m={name:'luna-language-budget-'+run,token:randomBytes(32).toString('base64url'),config:resolve(dir,'wrangler.json'),secrets:resolve(dir,'secrets.json'),runtimeSha:binding('RELEASE_SHA'),namespace:settings.bindings.find(b=>b.name==='LUNA_AI_BUDGET')?.namespace_id,usageBefore:usage}
 m.url=`https://${m.name}.gabrielboalento3004.workers.dev`
 console.log('::add-mask::'+m.token)
 await writeFile(m.secrets,JSON.stringify({TEST_TOKEN:m.token}),{mode:0o600});await writeFile(manifest,JSON.stringify(m),{mode:0o600})
 await deploy(m,false)
 const state=await proxy(m,'/status'),headroom=batchHeadroom(state,usage)
 if(headroom.floor>state.used){const ticket=await proxy(m,'/reserve',{bound:headroom.floor-state.used});await proxy(m,'/settle',{...ticket,actual:headroom.floor-state.used})}
 const reconciled=await proxy(m,'/status'),limits=batchHeadroom(reconciled,usage)
 m.start=reconciled.used;m.day=reconciled.day;m.cap=limits.cap
 if(limits.hold>0)m.hold=await proxy(m,'/reserve',{bound:limits.hold})
 await writeFile(manifest,JSON.stringify(m),{mode:0o600});await deploy(m,true)
 const activated=await waitForActivation(m,true);if(activated.stop)throw Error('BATCH_BUDGET_UNAVAILABLE')
 await appendFile(process.env.GITHUB_ENV,`LANGUAGE_PROXY_URL=${m.url}\nLANGUAGE_PROXY_TOKEN=${m.token}\nLANG_CASE_IDS=${requested.join(',')}\n`)
 console.log(JSON.stringify({event:'language.batch.ready',day:m.day,accountObserved:usage.used,sharedUsed:m.start,sharedReserved:activated.reserved,batchCap:m.cap,runtimeSha:m.runtimeSha,cases:requested}))
}else if(command==='finish'){
 if(!existsSync(manifest)){console.log(JSON.stringify({event:'language.batch.not_started'}));process.exit(0)}
 const m=JSON.parse(await readFile(manifest,'utf8')),report={event:'language.batch.finished',runtimeSha:m.runtimeSha,day:m.day,batchCap:m.cap,holdReleased:false,proxyDeleted:false}
 try{
  if(!m.day){report.stopReason='PREFLIGHT_FAILED_NO_INFERENCE';throw Error(report.stopReason)}
  const state=await proxy(m,'/status');report.counter=state;report.spent=state.used-m.start
  const usage=await accountUsage();report.accountObservedAfter=usage.used
  const hold=m.hold?.bound??0
  if(state.day===m.day&&Math.abs(state.reserved-hold)<0.00001){
   // No model reservation is in flight. Disabling inference precedes release.
   await deploy(m,false)
   await waitForActivation(m,false)
   if(m.hold)await proxy(m,'/settle',{...m.hold,actual:0})
   report.holdReleased=true
  }else report.stopReason='IN_FLIGHT_OR_DAY_CHANGED_HOLD_RETAINED'
  if(!Number.isFinite(report.spent)||report.spent>m.cap+0.00001||usage.used>=10000)report.stopReason='BUDGET_REQUIRES_REVIEW'
 }catch(error){report.stopReason=error.message}
 try{if(!/^luna-language-budget-\d+$/.test(m.name))throw Error('TEMP_SCRIPT_NAME_INVALID');await cf(`/accounts/${ACCOUNT}/workers/scripts/${m.name}`,{method:'DELETE'});report.proxyDeleted=true}catch{report.cleanupError='TEMP_PROXY_DELETE_FAILED'}
 await mkdir(out,{recursive:true});await writeFile(resolve(out,'budget-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
 if(report.stopReason||report.cleanupError)process.exitCode=1
}else throw Error('COMMAND_REQUIRED')
