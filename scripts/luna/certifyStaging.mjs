// Explicit operator CLI. Staging only; never invoked by the application/CI.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {build} from 'esbuild'
import {prepareStagingMigrations} from './prepareStagingMigrations.mjs'
import {createStagingHttpAdapter} from './stagingHttpAdapter.mjs'
import {runRealCertification,certificationManifestHash} from './realCertificationRunner.mjs'
const root=process.cwd(),out=resolve(root,'.artifacts/luna-certification-staging')
await mkdir(out,{recursive:true})
async function command(args,input){
 return new Promise((done,reject)=>{
  const child=spawn(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['pipe','pipe','pipe']})
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data)
  child.on('error',()=>reject(new Error('CERTIFICATION_WRANGLER_START_FAILED')))
  child.on('exit',code=>code===0?done(stdout):reject(new Error(`CERTIFICATION_WRANGLER_FAILED:${args[0]}:${args[1]}:${code}`)))
  child.stdin.end(input)
 })
}
async function git(args){return new Promise((done,reject)=>{const child=spawn('git',args,{cwd:root});let output='';child.stdout.on('data',data=>output+=data);child.on('exit',code=>code===0?done(output.trim()):reject(new Error('GIT_FAILED')))})}
const sha=await git(['rev-parse','HEAD']),normal=JSON.parse(await readFile(resolve(root,'apps/edge-api/wrangler.jsonc'),'utf8')),stage=normal.env.staging
if(stage.name!=='yuisync-edge-api-staging'||stage.vars.APP_ENV!=='staging'||stage.vars.LUNA_ENABLED!=='false'||stage.vars.LUNA_MODEL!=='openai/gpt-oss-20b'||stage.d1_databases.find(d=>d.binding==='DB')?.database_id!=='4abe6b77-3042-4960-88ef-1fdb43d488d1'||stage.d1_databases.find(d=>d.binding==='AUTH_DB')?.database_id!=='9157ec55-a04d-449e-a92c-710f8e39cd51')throw new Error('CERTIFICATION_STAGING_BINDINGS_INVALID')
await build({entryPoints:[resolve(root,'apps/edge-api/test/fixtures/luna/designedScenarios.ts')],outfile:resolve(out,'scenarios.mjs'),bundle:true,platform:'node',format:'esm'})
await build({entryPoints:[resolve(root,'scripts/luna/certificationSchema.ts')],outfile:resolve(out,'schema.mjs'),bundle:true,platform:'node',format:'esm'})
const {LUNA_DESIGNED_SCENARIOS:scenarios}=await import(new URL(`file:///${resolve(out,'scenarios.mjs').replaceAll('\\','/')}`))
const {CERTIFICATION_SCHEMA}=await import(new URL(`file:///${resolve(out,'schema.mjs').replaceAll('\\','/')}`))
const manifestHash=certificationManifestHash(scenarios)
if(process.argv.includes('--prepare')){
 let identity
 try{identity=JSON.parse(await readFile(resolve(out,'database.json'),'utf8'))}catch{
  const name=`luna-cert-staging-${Date.now()}`
  const created=await command(['d1','create',name,'--config',resolve(root,'apps/edge-api/wrangler.jsonc'),'--update-config','false'])
  const match=created.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)??created.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)
  if(!match)throw new Error('CERTIFICATION_DATABASE_ID_NOT_RECORDED')
  identity={name,id:match[1],environment:'isolated-luna-v2'}
  await writeFile(resolve(out,'database.json'),JSON.stringify(identity,null,2))
 }
 if(!identity.name.startsWith('luna-cert-staging-')||identity.environment!=='isolated-luna-v2'||Object.values(normal.env).some(e=>e.d1_databases?.some(d=>d.database_id===identity.id)))throw new Error('CERTIFICATION_FIXTURE_DATABASE_INVALID')
 const migrationPath=await prepareStagingMigrations(root),migration=JSON.parse(await readFile(migrationPath,'utf8'))
 migration.env.staging.d1_databases=[{binding:'DB',database_name:identity.name,database_id:identity.id,migrations_dir:resolve(root,'.artifacts/luna-remote-migrations')}]
 const migrationConfig=resolve(out,'migration.json');await writeFile(migrationConfig,JSON.stringify(migration,null,2))
 await command(['d1','migrations','apply','DB','--env','staging','--remote','--config',migrationConfig])
 await writeFile(resolve(out,'cert-schema.sql'),CERTIFICATION_SCHEMA.join(';\n')+`;\nINSERT INTO luna_cert_identity VALUES(1,'${identity.id}','isolated-luna-v2') ON CONFLICT DO NOTHING;\n`)
 const schemaOutput=await command(['d1','execute','DB','--env','staging','--remote','--config',migrationConfig,'--file',resolve(out,'cert-schema.sql'),'--json'])
 await writeFile(resolve(out,'provision-schema-result.json'),schemaOutput)
 const config={...normal,main:resolve(root,'scripts/luna/stagingWorker.ts'),assets:{...normal.assets,directory:resolve(root,'dist')},env:{staging:{...stage,vars:{...stage.vars,RELEASE_SHA:sha,LUNA_CERT_ENV:'isolated-luna-v2',LUNA_CERT_DATABASE_ID:identity.id},d1_databases:[...stage.d1_databases,{binding:'LUNA_CERT_DB',database_name:identity.name,database_id:identity.id}]}}}
 for(const binding of config.env.staging.d1_databases)if(binding.migrations_dir)binding.migrations_dir=resolve(root,'apps/edge-api',binding.migrations_dir)
 await writeFile(resolve(out,'wrangler.json'),JSON.stringify(config,null,2))
 console.log(JSON.stringify({prepared:true,sha,fixtureDatabaseId:identity.id,manifestHash}))
}
if(process.argv.includes('--run')){
 const gates=JSON.parse(await readFile(resolve(out,'gates.json'),'utf8'))
 if(gates.sha!==sha||!gates.passed||gates.offline.executed!==20||gates.offline.passed!==20||gates.offline.manifestHash!==manifestHash)throw new Error('CERTIFICATION_FINAL_GATES_REQUIRED')
 if(await git(['diff','HEAD','--','apps/edge-api/src','apps/edge-api/test','scripts/luna','test/luna']))throw new Error('CERTIFICATION_CODE_NOT_FROZEN')
 const configPath=resolve(out,'wrangler.json'),config=JSON.parse(await readFile(configPath,'utf8'))
 config.env.staging.vars.RELEASE_SHA=sha;await writeFile(configPath,JSON.stringify(config,null,2))
 // Rotate the temporary credential on resume. Only memory/stdin; never artifact.
 const token=randomBytes(32).toString('hex')
 await command(['secret','put','LUNA_CERT_TOKEN','--env','staging','--config',configPath],token+'\n')
 await command(['deploy','--env','staging','--config',configPath])
 const baseUrl='https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev/'
 const release=await (await fetch(new URL('release',baseUrl),{redirect:'error'})).json()
 if(release.release_sha!==sha||release.environment!=='staging')throw new Error('CERTIFICATION_RELEASE_SHA_MISMATCH')
 const roundId=`groq-${sha.slice(0,12)}`
 const {adapter,store}=await createStagingHttpAdapter({baseUrl,token,sha,roundId})
 if(adapter.provider!=='groq'||adapter.model!=='openai/gpt-oss-20b'||!adapter.configurationFingerprint)throw new Error('CERTIFICATION_PROVIDER_CONFIGURATION_MISMATCH')
 let result,error=null
 try{result=await runRealCertification({sha,roundId,gates,offline:gates.offline,scenarios,adapter,store})}catch(failure){error=failure.message;result=await store.load(roundId)}
 const budget=await adapter.budget()
 const report={sha,release,provider:adapter.provider,model:adapter.model,manifestHash,configurationFingerprint:adapter.configurationFingerprint,budget,result,error,transcriptsReviewed:0,certified:false}
 await writeFile(resolve(out,`round-${sha.slice(0,12)}.json`),JSON.stringify(report,null,2))
 console.log(JSON.stringify({sha,roundId,status:result?.status,error,budget,completed:Object.values(result?.scenarios??{}).filter(s=>s.status==='complete').length}))
}
