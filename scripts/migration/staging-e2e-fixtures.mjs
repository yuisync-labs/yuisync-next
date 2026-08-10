#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { hash } from 'bcryptjs'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const ARTIFACT_DIR = resolve(REPO_ROOT, '.artifacts/staging-e2e')
const MANIFEST_PATH = resolve(ARTIFACT_DIR, 'fixture.json')
const STAGING_URL = String(process.env.YUISYNC_STAGING_URL || 'https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev').replace(/\/$/, '')
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()

function sql(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim()
}

function wrangler(args) {
  return run('npx', ['wrangler', ...args], { cwd: EDGE_DIR })
}

function d1Run(binding, statement) {
  wrangler(['d1', 'execute', binding, '--env', 'staging', '--remote', '--command', statement])
}

function password() {
  return `${randomBytes(24).toString('base64url')}Aa1!`
}

function mask(value) {
  if (process.env.GITHUB_ACTIONS === 'true' && value) console.log(`::add-mask::${value}`)
}

async function exportEnv(entries) {
  const target = process.env.GITHUB_ENV
  if (!target) return
  await appendFile(target, `${Object.entries(entries).map(([key, value]) => `${key}=${String(value)}`).join('\n')}\n`, 'utf8')
}

function fixture() {
  const runId = `e2e-${Date.now()}-${randomBytes(4).toString('hex')}`
  const tenantId = `${runId}-tenant`
  const users = [
    { key: 'admin', role: 'admin', moduleRole: 'admin_pet', envEmail: 'E2E_EMAIL', envPassword: 'E2E_PASSWORD', name: 'E2E Admin' },
    { key: 'manager', role: 'manager', moduleRole: 'funcionario_pet', envEmail: 'E2E_MANAGER_EMAIL', envPassword: 'E2E_MANAGER_PASSWORD', name: 'E2E Manager' },
    { key: 'member', role: 'member', moduleRole: 'funcionario_pet', envEmail: 'E2E_COMMON_EMAIL', envPassword: 'E2E_COMMON_PASSWORD', name: 'E2E Member' },
  ].map((user) => ({
    ...user,
    userId: randomUUID(),
    principalId: randomUUID(),
    email: `${runId}-${user.key}@staging.invalid`,
    password: password(),
  }))
  return { schema: 'yuisync-staging-e2e-fixture/v1', runId, tenantId, users }
}

async function setup() {
  const current = fixture()
  const now = Date.now()
  await mkdir(ARTIFACT_DIR, { recursive: true })
  await writeFile(MANIFEST_PATH, JSON.stringify({
    schema: current.schema,
    runId: current.runId,
    tenantId: current.tenantId,
    users: current.users.map(({ key, role, moduleRole, userId, principalId, email }) => ({ key, role, moduleRole, userId, principalId, email })),
  }, null, 2))

  const authStatements = []
  const mainStatements = [
    `INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(${sql(current.tenantId)},${sql(current.tenantId)},'Staging E2E','active',${now},${now});`,
    `INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,created_at_ms,updated_at_ms) VALUES(${sql(current.tenantId)},'petshop','Staging E2E',${now},${now});`,
  ]
  const env = { E2E_BASE_URL: STAGING_URL }

  for (const user of current.users) {
    const passwordHash = await hash(user.password, 12)
    const modulePermissions = JSON.stringify({ petshop: user.moduleRole })
    authStatements.push(
      `INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(${sql(user.userId)},${sql(user.name)},${sql(user.email)},1,NULL,${now},${now});`,
      `INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(${sql(`credential:${user.userId}`)},${sql(user.userId)},${sql(user.userId)},'credential',${sql(passwordHash)},${now},${now});`,
    )
    mainStatements.push(
      `INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(${sql(user.principalId)},'better-auth',${sql(user.userId)},${sql(user.name)},${sql(user.email)},'active',${now},${now});`,
      `INSERT INTO tenant_memberships(tenant_id,principal_id,status,created_at_ms,updated_at_ms,role,module_permissions_json) VALUES(${sql(current.tenantId)},${sql(user.principalId)},'active',${now},${now},${sql(user.role)},${sql(modulePermissions)});`,
    )
    mask(user.password)
    env[user.envEmail] = user.email
    env[user.envPassword] = user.password
  }

  try {
    d1Run('AUTH_DB', authStatements.join(' '))
    d1Run('DB', mainStatements.join(' '))
    await exportEnv(env)
    console.log(JSON.stringify({ status: 'ready', run_id: current.runId, tenant_id: current.tenantId, users: current.users.map(({ key, role, moduleRole }) => ({ key, role, module_role: moduleRole })) }))
  } catch (error) {
    console.error(`Failed to prepare staging E2E fixtures: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

async function cleanup() {
  let manifest
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    console.log(`No staging E2E fixture manifest to clean: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const userIds = (manifest.users || []).map((user) => user.userId).filter(Boolean)
  const principalIds = (manifest.users || []).map((user) => user.principalId).filter(Boolean)
  const tenantId = String(manifest.tenantId || '')
  const errors = []

  if (userIds.length) {
    const users = userIds.map(sql).join(',')
    try {
      d1Run('AUTH_DB', `DELETE FROM session WHERE userId IN (${users}); DELETE FROM account WHERE userId IN (${users}); DELETE FROM user WHERE id IN (${users});`)
    } catch (error) {
      errors.push(`AUTH_DB:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (tenantId) {
    try {
      d1Run('DB', `DELETE FROM tenant_module_settings WHERE tenant_id=${sql(tenantId)}; DELETE FROM tenant_memberships WHERE tenant_id=${sql(tenantId)};${principalIds.length ? ` DELETE FROM identity_principals WHERE id IN (${principalIds.map(sql).join(',')});` : ''} DELETE FROM tenants WHERE id=${sql(tenantId)};`)
    } catch (error) {
      errors.push(`DB:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length) {
    throw new Error(`STAGING_E2E_CLEANUP_FAILED:${errors.join('|')}`)
  }
  console.log(JSON.stringify({ status: 'cleaned', run_id: manifest.runId || null, tenant_id: tenantId || null }))
}

if (!['setup', 'cleanup'].includes(COMMAND)) {
  console.error('Usage: node scripts/migration/staging-e2e-fixtures.mjs <setup|cleanup>')
  process.exit(2)
}

if (COMMAND === 'setup') await setup()
else await cleanup()
