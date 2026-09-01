import { randomBytes, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { hash } from 'bcryptjs'

import { createBetterAuthIntakeWriter } from './betterAuthIntakeWriter.mjs'
import { auditCanonicalD1Schema, buildD1SchemaAuditQuery } from './canonicalD1SchemaAudit.mjs'
import { createCanonicalD1Writer } from './canonicalD1Writer.mjs'
import { parseWranglerD1Json } from './foundationExtractors.mjs'
import { attachNormalizedAppointmentClients, projectNormalizedSupabaseClientsPets } from './normalizedClientsPetsIntake.mjs'
import { DESTINATION_TABLES, extractSupabaseOperationalSnapshot } from './operationalExtractors.mjs'

const execFileAsync = promisify(execFileCallback)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TENANT_ID = '29d6a509-8b35-47d0-ad19-7cee6f17328c'
const MODULE_ID = 'petshop'
const TENANT_SLUG = 'quatro-patas'
const PRODUCTION = process.argv.includes('--production')
const ENVIRONMENT = PRODUCTION ? 'production' : 'staging'
const LOGIN_EMAIL = PRODUCTION ? 'quatropatas@yuisync.app' : 'staging.quatropatas@yuisync.app'
const CONFIG_PATH = PRODUCTION ? 'apps/edge-api/.wrangler-production.jsonc' : 'apps/edge-api/wrangler.jsonc'
const CREDENTIAL_FILE = resolve(REPO_ROOT, `.migration/quatro-patas-${ENVIRONMENT}-credentials.json`)
const PAGE_SIZE = 500
const MAX_PAGES = 100
const RECONCILE_ONLY = process.argv.includes('--reconcile-only')
const PREFLIGHT_ONLY = process.argv.includes('--preflight-only')
const REPLACE_SALE_ITEMS = process.argv.includes('--replace-sale-items')
const ONLY_SALE_ITEMS = process.argv.includes('--only-sale-items') || REPLACE_SALE_ITEMS

async function retryRead(operation, attempts = 5) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation() } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500))
    }
  }
  throw lastError
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}

function sourceHeaders(key) {
  const headers = { accept:'application/json', apikey:key }
  if (!key.startsWith('sb_secret_')) headers.authorization = `Bearer ${key}`
  return headers
}

async function readSourceTable(baseUrl, key, table, params = {}, { paginate = true } = {}) {
  const rows = []
  for (let page = 0; page < (paginate ? MAX_PAGES : 1); page += 1) {
    const url = new URL(`/rest/v1/${table}`, baseUrl)
    url.searchParams.set('select', '*')
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
    const headers = sourceHeaders(key)
    if (paginate) headers.range = `${page * PAGE_SIZE}-${page * PAGE_SIZE + PAGE_SIZE - 1}`
    const response = await fetch(url, { headers, redirect:'error' })
    if (!response.ok) throw new Error(`Source ${table} returned HTTP ${response.status}.`)
    const batch = await response.json()
    if (!Array.isArray(batch)) throw new Error(`Source ${table} did not return rows.`)
    rows.push(...batch)
    if (!paginate || batch.length < PAGE_SIZE) return rows
  }
  throw new Error(`Source ${table} exceeded pagination limit.`)
}

async function credentials() {
  try {
    const existing = JSON.parse(await readFile(CREDENTIAL_FILE, 'utf8'))
    if (existing?.email === LOGIN_EMAIL && existing?.password && existing?.user_id && existing?.principal_id && existing?.created_at_ms) return existing
  } catch {}
  const created = {
    environment:ENVIRONMENT, tenant_id:TENANT_ID, email:LOGIN_EMAIL,
    password:randomBytes(24).toString('base64url'), user_id:randomUUID(), principal_id:randomUUID(),
    created_at_ms:Date.now(),
  }
  await mkdir(dirname(CREDENTIAL_FILE), { recursive:true })
  await writeFile(CREDENTIAL_FILE, `${JSON.stringify(created, null, 2)}\n`, { encoding:'utf8', mode:0o600 })
  return created
}

async function runBindingSelect(binding, sql) {
  const wrangler = resolve(REPO_ROOT, 'node_modules/wrangler/bin/wrangler.js')
  const config = resolve(REPO_ROOT, CONFIG_PATH)
  const result = await execFileAsync(process.execPath, [wrangler,'d1','execute',binding,'--remote','--env',ENVIRONMENT,'--config',config,'--command',sql,'--json'], {
    cwd:REPO_ROOT, encoding:'utf8', maxBuffer:8 * 1024 * 1024, windowsHide:true, env:process.env,
  })
  return parseWranglerD1Json(result.stdout)
}

function countQuery(collections) {
  return Object.keys(collections).filter((table) => collections[table].length).map((table) => {
    const where = table === 'tenants'
      ? `id='${TENANT_ID}'`
      : `tenant_id='${TENANT_ID}'${collections[table][0]?.module_id === MODULE_ID ? ` AND module_id='${MODULE_ID}'` : ''}`
    return `SELECT '${table}' AS table_name,COUNT(*) AS row_count FROM ${table} WHERE ${where}`
  }).join(' UNION ALL ')
}

function countQueryBatches(collections, size = 4) {
  const entries = Object.entries(collections).filter(([, rows]) => rows.length)
  const queries = []
  for (let offset = 0; offset < entries.length; offset += size) {
    queries.push(countQuery(Object.fromEntries(entries.slice(offset, offset + size))))
  }
  return queries
}

async function readCounts(runner, collections) {
  const rows = []
  for (const query of countQueryBatches(collections)) {
    const tables = [...query.matchAll(/SELECT '([a-z0-9_]+)' AS table_name/gu)].map((match) => match[1])
    console.log(JSON.stringify({ stage:'reconcile-batch',tables }))
    rows.push(...await retryRead(() => runner(query)))
  }
  return rows
}

function assertCounts(collections, rows) {
  const actual = new Map(rows.map((row) => [row.table_name, Number(row.row_count)]))
  const mismatches = Object.fromEntries(Object.entries(collections).filter(([, values]) => values.length).flatMap(([table, values]) => {
    const found = actual.get(table) || 0
    return found === values.length ? [] : [[table, { expected:values.length, actual:found }]]
  }))
  if (Object.keys(mismatches).length) throw new Error(`${ENVIRONMENT} row-count reconciliation failed: ${JSON.stringify(mismatches)}`)
}

async function main() {
  const supabaseUrl = requiredEnv('SUPABASE_URL')
  const adminApiKey = requiredEnv('SUPABASE_SECRET_KEY')
  const baseUrl = new URL(supabaseUrl)
  const scope = { tenant_id:TENANT_ID, module_id:MODULE_ID }
  const login = await credentials()
  const runId = `quatro-patas-${ENVIRONMENT}-${login.created_at_ms}`
  const productionAuthorization = PRODUCTION ? `AUTHORIZE_MIGRATION_RUN:${runId}` : null
  console.log(JSON.stringify({ stage:'extracting', run_id:runId }))

  const [tenantRows, settingsRows, clients, pets, appointments, operational] = await Promise.all([
    readSourceTable(baseUrl,adminApiKey,'tenants',{ id:`eq.${TENANT_ID}` },{ paginate:false }),
    readSourceTable(baseUrl,adminApiKey,'settings',{ tenant_id:`eq.${TENANT_ID}`, module_id:`eq.${MODULE_ID}` },{ paginate:false }),
    readSourceTable(baseUrl,adminApiKey,'clients',{ tenant_id:`eq.${TENANT_ID}`, module_id:`eq.${MODULE_ID}`, order:'id.asc' }),
    readSourceTable(baseUrl,adminApiKey,'pets',{ tenant_id:`eq.${TENANT_ID}`, module_id:`eq.${MODULE_ID}`, order:'id.asc' }),
    readSourceTable(baseUrl,adminApiKey,'appointments',{ tenant_id:`eq.${TENANT_ID}`, module_id:`eq.${MODULE_ID}`, order:'id.asc' }),
    extractSupabaseOperationalSnapshot({ supabaseUrl, adminApiKey, scope }),
  ])
  const tenant = tenantRows[0]
  const setting = settingsRows[0]
  if (!tenant || !setting) throw new Error('Quatro Patas tenant/settings not found in source.')
  const normalized = projectNormalizedSupabaseClientsPets({ clients,pets,appointments,scope,now:login.created_at_ms })
  const foundation = {
    tenants:[{ id:TENANT_ID, slug:TENANT_SLUG, name:String(setting.store_name || tenant.name || 'PetShop QuatroPatas').trim(), status:tenant.active === false ? 'inactive' : 'active', created_at_ms:login.created_at_ms, updated_at_ms:login.created_at_ms }],
    tenant_module_settings:[{
      tenant_id:TENANT_ID,module_id:MODULE_ID,store_name:String(setting.store_name || ''),store_phone:String(setting.store_phone || ''),
      store_address:String(setting.store_address || ''),store_neighborhood:String(setting.store_neighborhood || ''),store_city:String(setting.store_city || ''),
      bot_prompt:String(setting.bot_prompt || ''),version:1,created_at_ms:login.created_at_ms,updated_at_ms:login.created_at_ms,
    }],
  }
  const alignedAppointments = attachNormalizedAppointmentClients({ appointments:operational.collections.appointments,pets:normalized.pets })
  const data = { clients:normalized.clients, pets:normalized.pets, ...operational.collections, appointments:alignedAppointments.appointments }
  const allTableNames = [...new Set([...Object.keys(foundation),...Object.keys(data),...DESTINATION_TABLES])]
  const runner = (sql) => runBindingSelect('DB', sql)
  const schemaRows = await retryRead(() => runner(buildD1SchemaAuditQuery(allTableNames)))
  for (const collections of [foundation,data]) {
    const report = auditCanonicalD1Schema({ collections,schemaRows })
    if (!report.compatible) throw new Error(`D1 schema is incompatible: ${JSON.stringify(report.tables)}`)
  }

  const [existingTenant, existingAuth, existingPrincipal] = await Promise.all([
    retryRead(() => runner(`SELECT id,slug,name FROM tenants WHERE id='${TENANT_ID}' OR slug='${TENANT_SLUG}'`)),
    retryRead(() => runBindingSelect('AUTH_DB', `SELECT id,email FROM user WHERE id='${login.user_id}' OR lower(email)='${LOGIN_EMAIL}'`)),
    retryRead(() => runner(`SELECT id,subject,email FROM identity_principals WHERE id='${login.principal_id}' OR subject='${login.user_id}' OR lower(email)='${LOGIN_EMAIL}'`)),
  ])
  if (existingTenant.some((row) => row.id !== TENANT_ID || row.slug !== TENANT_SLUG)) throw new Error(`${ENVIRONMENT} tenant collision.`)
  if (existingAuth.some((row) => row.id !== login.user_id || String(row.email).toLowerCase() !== LOGIN_EMAIL)) throw new Error(`${ENVIRONMENT} auth collision.`)
  if (existingPrincipal.some((row) => row.id !== login.principal_id || row.subject !== login.user_id)) throw new Error(`${ENVIRONMENT} principal collision.`)

  if (PREFLIGHT_ONLY) {
    const scopedCounts = await readCounts(runner, { ...foundation, ...data })
    const occupied = scopedCounts.filter((row) => Number(row.row_count) !== 0)
    if (existingTenant.length || existingAuth.length || existingPrincipal.length || occupied.length) {
      throw new Error(`${ENVIRONMENT} preflight found existing migration scope: ${JSON.stringify({
        tenant:existingTenant.length, auth:existingAuth.length, principal:existingPrincipal.length, tables:occupied,
      })}`)
    }
    console.log(JSON.stringify({ status:`${ENVIRONMENT}-preflight-clear`, run_id:runId, credential_file:CREDENTIAL_FILE }))
    return
  }

  const canonicalWriter = createCanonicalD1Writer({ environment:ENVIRONMENT, configPath:CONFIG_PATH, productionAuthorization })
  if (!RECONCILE_ONLY) {
    if (!ONLY_SALE_ITEMS) {
      console.log(JSON.stringify({ stage:'foundation', rows:Object.values(foundation).reduce((sum,rows)=>sum+rows.length,0) }))
      await canonicalWriter({ runId,collections:foundation,schemaRows,tenantId:TENANT_ID,moduleId:MODULE_ID })

      const passwordHash = await hash(login.password, 12)
      const authProjection = {
        sensitive:true,
        authUsers:[{ id:login.user_id,name:'Administrador Quatro Patas',email:LOGIN_EMAIL,emailVerified:1,image:null,createdAt:login.created_at_ms,updatedAt:login.created_at_ms }],
        authAccounts:[{ id:`credential:${login.user_id}`,userId:login.user_id,accountId:login.user_id,providerId:'credential',password:passwordHash,createdAt:login.created_at_ms,updatedAt:login.created_at_ms }],
        principals:[{ id:login.principal_id,provider:'better-auth',subject:login.user_id,display_name:'Administrador Quatro Patas',email:LOGIN_EMAIL,status:'active',created_at_ms:login.created_at_ms,updated_at_ms:login.created_at_ms }],
        tenantMemberships:[{ tenant_id:TENANT_ID,principal_id:login.principal_id,status:'active',role:'owner',module_permissions_json:JSON.stringify({ petshop:{ role:'admin_pet' } }),created_at_ms:login.created_at_ms,updated_at_ms:login.created_at_ms }],
        managedProfiles:[{ principal_id:login.principal_id,staff_type:'gerente',preferred_tenant_id:TENANT_ID,created_at_ms:login.created_at_ms,updated_at_ms:login.created_at_ms }],
      }
      console.log(JSON.stringify({ stage:'auth', users:1 }))
      await createBetterAuthIntakeWriter({ environment:ENVIRONMENT, configPath:CONFIG_PATH, productionAuthorization, collisionCheckPassed:true })({ runId,projection:authProjection })
    }

    const canonicalData = ONLY_SALE_ITEMS ? { sale_items:data.sale_items } : data
    if (REPLACE_SALE_ITEMS) {
      console.log(JSON.stringify({ stage:'replacing-sale-items', rows:data.sale_items.length }))
      await runner(`DELETE FROM sale_items WHERE tenant_id='${TENANT_ID}' AND module_id='${MODULE_ID}'`)
    }
    console.log(JSON.stringify({ stage:ONLY_SALE_ITEMS ? 'canonical-sale-items' : 'canonical-data', rows:Object.values(canonicalData).reduce((sum,rows)=>sum+rows.length,0) }))
    await canonicalWriter({ runId,collections:canonicalData,schemaRows,tenantId:TENANT_ID,moduleId:MODULE_ID })
  }

  console.log(JSON.stringify({ stage:'reconciling' }))
  assertCounts(foundation, await readCounts(runner, foundation))
  assertCounts(data, await readCounts(runner, data))
  const authCheck = await retryRead(() => runBindingSelect('AUTH_DB', `SELECT COUNT(*) AS row_count FROM user WHERE id='${login.user_id}' AND lower(email)='${LOGIN_EMAIL}'`))
  const membershipCheck = await retryRead(() => runner(`SELECT COUNT(*) AS row_count FROM tenant_memberships WHERE tenant_id='${TENANT_ID}' AND principal_id='${login.principal_id}' AND role='owner' AND status='active'`))
  if (Number(authCheck[0]?.row_count) !== 1 || Number(membershipCheck[0]?.row_count) !== 1) throw new Error(`${ENVIRONMENT} auth reconciliation failed.`)

  console.log(JSON.stringify({
    status:`${ENVIRONMENT}-migrated-and-reconciled`,run_id:runId,credential_file:CREDENTIAL_FILE,
    source_counts:{ clients:clients.length,pets:pets.length,appointments:appointments.length },
    destination_counts:{ clients:normalized.clients.length,pets:normalized.pets.length,canonical_rows:Object.values(data).reduce((sum,rows)=>sum+rows.length,0) },
    normalized_references:{ inferred_appointment_client_ids:alignedAppointments.inferred_client_ids },
  }))
}

await main()
