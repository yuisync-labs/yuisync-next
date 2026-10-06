// Transport-only SQL normalization for the D1 remote parser. Historical files
// and statement semantics are preserved; never use this bundle for production.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
export function remoteMigrationSql(sql) {
  return sql.replace(/\r\n/g,'\n').replace(/SELECT\s+CASE\b([\s\S]*?)\bEND\s*;/g, 'SELECT (CASE$1END);') + '\nSELECT 1;\n'
}
export async function prepareStagingMigrations(root) {
  const out=resolve(root,'.artifacts/luna-remote-migrations'),input=resolve(root,'apps/edge-api/migrations')
  await mkdir(out,{recursive:true})
  const manifest=[]
  for(const name of (await readdir(input)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort()){
    const sql=await readFile(resolve(input,name),'utf8'),normalized=remoteMigrationSql(sql)
    await writeFile(resolve(out,name),normalized)
    manifest.push({name,sourceHash:createHash('sha256').update(sql).digest('hex'),transportHash:createHash('sha256').update(normalized).digest('hex')})
  }
  const config=JSON.parse(await readFile(resolve(root,'apps/edge-api/wrangler.jsonc'),'utf8'))
  const staging=config.env.staging
  if(staging.name!=='yuisync-edge-api-staging'||staging.d1_databases.find(db=>db.binding==='DB')?.database_id!=='4abe6b77-3042-4960-88ef-1fdb43d488d1')throw new Error('STAGING_SCOPE_MISMATCH')
  // The generated configuration is ONLY a migration target, never a deployment configuration.
  const migrationConfig={account_id:config.account_id,name:'luna-staging-migration-transport',env:{staging:{d1_databases:staging.d1_databases.filter(db=>db.binding==='DB').map(db=>({...db,migrations_dir:out}))}}}
  const path=resolve(out,'wrangler.json')
  await writeFile(path,JSON.stringify(migrationConfig,null,2));await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2))
  return path
}
if(process.argv[1]?.endsWith('prepareStagingMigrations.mjs'))console.log(await prepareStagingMigrations(process.cwd()))
