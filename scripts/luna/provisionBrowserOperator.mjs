// One dedicated staging-only admin. Credentials remain in ignored local storage.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {hash} from 'bcryptjs'
const root=process.cwd(),dir=resolve(root,'.artifacts/luna-certification-staging'),file=resolve(dir,'browser-operator.json')
execFileSync('git',['check-ignore','.artifacts/luna-certification-staging/browser-operator.json'],{stdio:'pipe'})
const config=JSON.parse(await readFile(resolve(root,'apps/edge-api/wrangler.jsonc'),'utf8')),stage=config.env.staging
if(stage.name!=='yuisync-edge-api-staging'||stage.vars.APP_ENV!=='staging'||stage.d1_databases.find(d=>d.binding==='DB')?.database_id!=='4abe6b77-3042-4960-88ef-1fdb43d488d1'||stage.d1_databases.find(d=>d.binding==='AUTH_DB')?.database_id!=='9157ec55-a04d-449e-a92c-710f8e39cd51')throw Error('STAGING_OPERATOR_BINDINGS_INVALID')
await mkdir(dir,{recursive:true})
let operator
try{operator=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;operator={id:randomUUID(),principal:randomUUID(),email:`luna-cert-${randomUUID()}@staging.invalid`,password:randomBytes(24).toString('base64url')+'Aa1!',environment:'staging',purpose:'Luna certification browser only'};await writeFile(file,JSON.stringify(operator,null,2),{flag:'wx',mode:0o600})}
if(operator.environment!=='staging'||!operator.email.endsWith('@staging.invalid'))throw Error('INVALID_OPERATOR_MANIFEST')
const q=value=>"'"+String(value).replaceAll("'","''")+"'",now=Date.now(),date=q(new Date(now).toISOString())
const statements={AUTH_DB:[
 `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(${q(operator.id)},'Luna certification staging admin',${q(operator.email)},1,${date},${date}) ON CONFLICT(id) DO NOTHING`,
 `INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(${q('credential:'+operator.id)},${q(operator.id)},${q(operator.id)},'credential',${q(await hash(operator.password,12))},${date},${date}) ON CONFLICT(id) DO NOTHING`,
],DB:[
 `INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(${q(operator.principal)},'better-auth',${q(operator.id)},'Luna certification staging admin',${q(operator.email)},'active',${now},${now}) ON CONFLICT(id) DO NOTHING`,
 `INSERT INTO platform_administrators(principal_id,status,created_at_ms,updated_at_ms) VALUES(${q(operator.principal)},'active',${now},${now}) ON CONFLICT(principal_id) DO NOTHING`,
]}
const totals={reads:0,writes:0,environment:'staging',beforeCertificationRound:true}
for(const [binding,sql] of Object.entries(statements)){
 const sqlFile=resolve(dir,`browser-operator-${binding}.sql`);await writeFile(sqlFile,sql.join(';\n')+';\n',{mode:0o600})
 const raw=execFileSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute',binding,'--config',resolve(root,'apps/edge-api/wrangler.jsonc'),'--env','staging','--remote','--file',sqlFile,'--json'],{stdio:'pipe',encoding:'utf8',timeout:60000})
 await writeFile(resolve(dir,`browser-operator-${binding}-result.log`),raw)
 const json=raw.match(/\[\s*\{[\s\S]*\]\s*$/)?.[0]
 if(!json)throw Error('OPERATOR_ACCOUNTING_UNKNOWN')
 const results=JSON.parse(json);for(const result of results){if(!result.success||!Number.isSafeInteger(result.meta?.rows_read)||!Number.isSafeInteger(result.meta?.rows_written))throw Error('OPERATOR_ACCOUNTING_UNKNOWN');totals.reads+=result.meta.rows_read;totals.writes+=result.meta.rows_written}
}
await writeFile(resolve(dir,'browser-operator-provision.json'),JSON.stringify(totals,null,2))
console.log(JSON.stringify({created:true,credentialsFile:file,...totals}))
