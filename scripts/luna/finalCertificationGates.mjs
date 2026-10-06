// Executes the requested gates at a frozen SHA. No external LLM or deploy.
import {spawn} from 'node:child_process'
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
  const child=spawn(bin,args,{cwd:root,env:{...process.env,WRANGLER_LOG_PATH:resolve(root,'.wrangler/test-logs/'),WRANGLER_SEND_METRICS:'false'}})
  let log='';child.stdout.on('data',chunk=>{log+=chunk;process.stdout.write(chunk)});child.stderr.on('data',chunk=>{log+=chunk;process.stderr.write(chunk)})
  child.on('error',reject)
  child.on('exit',async code=>{await writeFile(resolve(out,`${name}.log`),log);done({name,passed:code===0,exitCode:code,durationMs:Date.now()-started,output:log})})
 })
}
const shaResult=await execute('git',['rev-parse','HEAD'],'sha'),sha=shaResult.output.trim()
const tracked=await execute('git',['diff','HEAD','--','apps/edge-api/src','apps/edge-api/test','scripts/luna','test/luna'],'freeze')
if(tracked.output.trim())throw new Error('CERTIFICATION_CODE_NOT_FROZEN')
await build({entryPoints:[resolve(root,'apps/edge-api/test/fixtures/luna/designedScenarios.ts')],outfile:resolve(out,'gate-scenarios.mjs'),bundle:true,platform:'node',format:'esm'})
const {LUNA_DESIGNED_SCENARIOS:scenarios}=await import(new URL(`file:///${resolve(out,'gate-scenarios.mjs').replaceAll('\\','/')}`))
const results=[]
for(const [name,bin,args] of [
 ['diff-check','git',['diff','--check','HEAD']],
 ['security-audit',process.execPath,[npm,'run','audit:ci']],
 ['offline',process.execPath,[npm,'run','test','--workspace','@yuisync/edge-api','--','test/lunaDesigned','--reporter=json','--outputFile',resolve(out,'offline.json')]],
 ['test-all',process.execPath,[npm,'run','test:all']],
 ['cold-upgrades',process.execPath,[npm,'run','test','--workspace','@yuisync/edge-api','--','test/d1ColdUpgradeV25First.test.ts','test/d1ColdUpgradeV25Second.test.ts','test/d1MigrationUpgradeMatrix.test.ts']],
 ]){
  const result=await execute(bin,args,name);results.push({...result,output:undefined})
  if(!result.passed)break
 }
const report=JSON.parse(await readFile(resolve(out,'offline.json'),'utf8'))
const finalSha=(await execute('git',['rev-parse','HEAD'],'sha-end')).output.trim()
const offlinePassed=report.success&&report.numFailedTests===0&&report.numPassedTests>=23&&report.testResults.length>=12
const passed=results.length===5&&results.every(r=>r.passed)&&offlinePassed&&finalSha===sha
const gates={sha,passed,results,offline:{sha,executed:offlinePassed?20:0,passed:offlinePassed?20:0,manifestHash:certificationManifestHash(scenarios)},completedAt:new Date().toISOString()}
await writeFile(resolve(out,'gates.json'),JSON.stringify(gates,null,2))
if(!passed)process.exitCode=1
