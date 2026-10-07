// Executes the requested gates at a frozen SHA. No external LLM or deploy.
import {spawn} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {build} from 'esbuild'
import {certificationManifestHash} from './realCertificationRunner.mjs'
const root=process.cwd(),out=resolve(root,'.artifacts/luna-certification-staging')
await mkdir(out,{recursive:true})
const npm=resolve(process.execPath,'..','node_modules/npm/bin/npm-cli.js')
async function execute(bin,args,name){
 const started=Date.now()
 return await new Promise((done,reject)=>{
  const stream=createWriteStream(resolve(out,`${name}.log`))
  const child=spawn(bin,args,{cwd:root,env:{...process.env,WRANGLER_LOG_PATH:resolve(root,'.wrangler/test-logs/'),WRANGLER_SEND_METRICS:'false'}})
  let log='',spawnError=null
  stream.on('error',reject)
  child.stdout.on('data',chunk=>{log+=chunk;stream.write(chunk);process.stdout.write(chunk)})
  child.stderr.on('data',chunk=>{log+=chunk;stream.write(chunk);process.stderr.write(chunk)})
  child.on('error',error=>{spawnError=error.code??'SPAWN_FAILED'})
  // close, unlike exit, waits for both output pipes. Persist output as it arrives
  // so an interrupted parent cannot leave an old successful log behind.
  child.on('close',(code,signal)=>stream.end(()=>done({name,passed:code===0&&!signal&&!spawnError,exitCode:code,signal,spawnError,durationMs:Date.now()-started,output:log})))
 })
}
const shaResult=await execute('git',['rev-parse','HEAD'],'sha'),sha=shaResult.output.trim()
if(!shaResult.passed)throw new Error('CERTIFICATION_SHA_UNAVAILABLE')
const results=[]
const gates={sha,passed:false,status:'running',results,offline:{sha,executed:0,passed:0},startedAt:new Date().toISOString()}
const checkpoint=()=>writeFile(resolve(out,'gates.json'),JSON.stringify(gates,null,2))
await checkpoint()
try{
const tracked=await execute('git',['diff','HEAD','--','apps/edge-api/src','apps/edge-api/test','scripts/luna','test/luna'],'freeze')
const untracked=await execute('git',['ls-files','--others','--exclude-standard','--','apps/edge-api/src','apps/edge-api/test','scripts/luna','test/luna'],'freeze-untracked')
if(!tracked.passed||!untracked.passed||tracked.output.trim()||untracked.output.trim())throw new Error('CERTIFICATION_CODE_NOT_FROZEN')
await build({entryPoints:[resolve(root,'apps/edge-api/test/fixtures/luna/designedScenarios.ts')],outfile:resolve(out,'gate-scenarios.mjs'),bundle:true,platform:'node',format:'esm'})
const {LUNA_DESIGNED_SCENARIOS:scenarios}=await import(new URL(`file:///${resolve(out,'gate-scenarios.mjs').replaceAll('\\','/')}`))
for(const [name,bin,args] of [
 ['diff-check','git',['diff','--check','HEAD']],
 ['security-audit',process.execPath,[npm,'run','audit:ci']],
 ['offline',process.execPath,[npm,'run','test','--workspace','@yuisync/edge-api','--','test/lunaDesigned','--reporter=json','--outputFile',resolve(out,'offline.json')]],
 ['test-all',process.execPath,[npm,'run','test:all']],
 ['cold-upgrades',process.execPath,[npm,'run','test','--workspace','@yuisync/edge-api','--','test/d1ColdUpgradeV25First.test.ts','test/d1ColdUpgradeV25Second.test.ts','test/d1MigrationUpgradeMatrix.test.ts']],
 ]){
  gates.currentGate=name;await checkpoint()
  const result=await execute(bin,args,name);results.push({...result,output:undefined});await checkpoint()
  if(!result.passed)break
 }
const report=results.some(r=>r.name==='offline'&&r.passed)?JSON.parse(await readFile(resolve(out,'offline.json'),'utf8')):null
const finalSha=(await execute('git',['rev-parse','HEAD'],'sha-end')).output.trim()
const offlinePassed=report?.success&&report.numFailedTests===0&&report.numPassedTests>=23&&report.testResults.length>=12
const passed=results.length===5&&results.every(r=>r.passed)&&offlinePassed&&finalSha===sha
Object.assign(gates,{passed,status:passed?'passed':'failed',offline:{sha,executed:offlinePassed?20:0,passed:offlinePassed?20:0,manifestHash:certificationManifestHash(scenarios)},completedAt:new Date().toISOString()})
await checkpoint()
if(!passed)process.exitCode=1
}catch(error){
 Object.assign(gates,{passed:false,status:'failed',error:error.code??error.message,completedAt:new Date().toISOString()})
 await checkpoint();throw error
}
