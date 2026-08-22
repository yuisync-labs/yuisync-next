#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname)
const EDGE_DIR = resolve(REPO_ROOT, 'apps/edge-api')
const BASE_MANIFEST = resolve(REPO_ROOT, '.artifacts/staging-e2e/fixture.json')
const ARTIFACT_DIR = resolve(REPO_ROOT, '.artifacts/legacy-regression')
const DOMAIN_MANIFEST = resolve(ARTIFACT_DIR, 'fixture.json')
const WRANGLER_ENV = String(process.env.YUISYNC_E2E_WRANGLER_ENV || 'staging').trim()
const COMMAND = String(process.argv[2] || '').trim().toLowerCase()

if (WRANGLER_ENV !== 'staging') throw new Error(`LEGACY_REGRESSION_STAGING_ONLY:${WRANGLER_ENV}`)

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

function d1Run(statement) {
  wrangler(['d1', 'execute', 'DB', '--env', WRANGLER_ENV, '--remote', '--command', statement])
}

async function exportEnv(entries) {
  if (!process.env.GITHUB_ENV) return
  await appendFile(
    process.env.GITHUB_ENV,
    `${Object.entries(entries).map(([key, value]) => `${key}=${String(value)}`).join('\n')}\n`,
    'utf8',
  )
}

function guardE2eTenant(tenantId) {
  const id = String(tenantId || '')
  if (!id.startsWith('e2e-') || !id.endsWith('-tenant')) {
    throw new Error(`REFUSING_NON_E2E_TENANT:${id}`)
  }
  return id
}

async function setup() {
  const base = JSON.parse(await readFile(BASE_MANIFEST, 'utf8'))
  const tenantId = guardE2eTenant(base.tenantId)
  const runId = String(base.runId || '')
  if (!runId.startsWith('e2e-')) throw new Error(`INVALID_E2E_RUN_ID:${runId}`)

  const now = Date.now()
  const scheduledAt = now + 24 * 60 * 60 * 1000
  const ids = {
    clientId: `${runId}-client`,
    petSmallId: `${runId}-pet-small`,
    petMediumId: `${runId}-pet-medium`,
    petCatId: `${runId}-pet-cat`,
    serviceSmallId: `${runId}-svc-small`,
    serviceMediumId: `${runId}-svc-medium`,
    serviceLargeId: `${runId}-svc-large`,
    serviceCatId: `${runId}-svc-cat`,
    productId: `${runId}-product`,
    planId: `${runId}-plan`,
    subscriptionId: `${runId}-subscription`,
    packageAppointmentId: `${runId}-package-appointment`,
    packageAllocationId: `${runId}-package-allocation`,
    foreignTenantId: `${runId}-foreign-tenant`,
    foreignClientId: `${runId}-foreign-client`,
  }
  const codes = {
    small: `banho-pequeno-${runId}`,
    medium: `banho-medio-${runId}`,
    large: `banho-grande-${runId}`,
    cat: `banho-gato-${runId}`,
  }

  const packageBenefits = JSON.stringify([
    { kind: 'service', service_code: codes.small, status: 'reserved', catalog_price: 55 },
  ])

  const statements = [
    `INSERT INTO clients(tenant_id,module_id,id,name,document,phone,email,birth_date,address,address_number,address_complement,address_reference,neighborhood,city,postal_code,notes,status,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.clientId)},'Tutor Regressao','123.456.789-00','(32) 99999-1111','tutor.regressao@staging.invalid','1990-01-01','Rua QA','123','Apto 1','Portao azul','Centro','Muriae','36880-000','Tutor usado apenas pela bateria E2E','active',${now},${now});`,
    `INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.petSmallId)},${sql(ids.clientId)},'Nina QA','dog','Shih Tzu','2022-01-01',10.099,'Branca','Pet limite pequeno','active',${now},${now});`,
    `INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.petMediumId)},${sql(ids.clientId)},'Theo QA','dog','SRD','2021-02-01',10.100,'Caramelo','Pet limite medio','active',${now},${now});`,
    `INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,breed,birth_date,weight_kg,color,notes,status,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.petCatId)},${sql(ids.clientId)},'Mia QA','cat','SRD','2023-03-01',8.000,'Cinza','Pet para validar especie','active',${now},${now});`,
    `INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.serviceSmallId)},${sql(codes.small)},'Banho Pequeno QA','banho_tosa',5500,60,'percentage',500,1,'active',${now},${now},0,10.099,'dog',0,10099);`,
    `INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.serviceMediumId)},${sql(codes.medium)},'Banho Medio QA','banho_tosa',7000,75,'percentage',500,2,'active',${now},${now},10.100,22.100,'dog',10100,22100);`,
    `INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.serviceLargeId)},${sql(codes.large)},'Banho Grande QA','banho_tosa',9000,90,'percentage',500,3,'active',${now},${now},22.101,40.000,'dog',22101,40000);`,
    `INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,sort_order,status,created_at_ms,updated_at_ms,min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.serviceCatId)},${sql(codes.cat)},'Banho Gato QA','banho_tosa',6000,60,'percentage',500,4,'active',${now},${now},0,10.099,'cat',0,10099);`,
    `INSERT INTO catalog_products(tenant_id,module_id,id,name,barcode,category,description,price_cents,cost_cents,species_target,bot_metadata_json,status,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.productId)},'Racao E2E QA',${sql(`789-${runId}`)},'Racao','Produto descartavel da regressao',2500,1200,'dog','{}','active',${now},${now});`,
    `INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.productId)},10000,0,1000,1,${now});`,
    `INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.planId)},'Plano Banho QA',10000,'monthly',${sql(JSON.stringify([{ service_type: codes.small, qty_per_cycle: 4 }, { service_type: 'motodog', qty_per_cycle: 1 }]))},'active',${now},${now});`,
    `INSERT INTO client_subscriptions(tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,services_used_json,cancelled_at_ms,created_at_ms,updated_at_ms)
      VALUES(${sql(tenantId)},'petshop',${sql(ids.subscriptionId)},${sql(ids.planId)},${sql(ids.clientId)},'active',${now},'2026-09-30','{}',NULL,${now},${now});`,
    `INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order)
      VALUES(${sql(tenantId)},'petshop','buscar_e_levar','Buscar e levar',2000,NULL,1,1,0,'active',1);`,
    `INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order)
      VALUES(${sql(tenantId)},'petshop','somente_levar','Somente levar',1000,NULL,0,1,0,'active',2);`,
    `INSERT INTO appointments(
      tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,
      subtotal_cents,transport_fee_cents,notes,version,created_at_ms,updated_at_ms,
      subscription_id,subscription_benefit_used,subscription_benefit_status,subscription_benefits_json,
      subscription_label,subscription_discount_cents,billing_intent_type,billing_intent_subscription_id
    ) VALUES(${sql(tenantId)},'petshop',${sql(ids.packageAppointmentId)},${sql(ids.clientId)},${sql(ids.petSmallId)},${scheduledAt},60,'banho_tosa','scheduled','manual',5500,2000,'Seed P0 pacote + MotoDog',1,${now},${now},
      ${sql(ids.subscriptionId)},1,'reserved',${sql(packageBenefits)},'Plano Banho QA',5500,'subscription',${sql(ids.subscriptionId)});`,
    `INSERT INTO appointment_services(
      tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,
      unit_price_cents,duration_min,benefit_used,catalog_price_cents,commission_basis_points,
      min_weight_kg,max_weight_kg,species_target,min_weight_grams,max_weight_grams
    ) VALUES(${sql(tenantId)},'petshop',${sql(ids.packageAppointmentId)},0,${sql(ids.serviceSmallId)},${sql(codes.small)},'Banho Pequeno QA','banho_tosa',5500,60,1,5500,500,0,10.099,'dog',0,10099);`,
    `INSERT INTO subscription_benefit_allocations(
      tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
      benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
      version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
    ) VALUES(${sql(tenantId)},'petshop',${sql(ids.packageAllocationId)},${sql(ids.subscriptionId)},${sql(ids.packageAppointmentId)},0,
      'service',${sql(codes.small)},${sql(codes.small)},'reserved',${sql(`${runId}:reserved-package-seed`)},5500,1,${now},NULL,NULL,${now},${now});`,
    `INSERT INTO appointment_transport(
      tenant_id,module_id,appointment_id,option_id,fee_cents,pickup_address,dropoff_address,
      pickup_reference,dropoff_reference,contact_phone,status,notes,updated_at_ms
    ) VALUES(${sql(tenantId)},'petshop',${sql(ids.packageAppointmentId)},'buscar_e_levar',2000,'Rua QA, 123','Rua QA, 123',
      'Portao azul','Portao azul','(32) 99999-1111','pending','Seed P0 MotoDog',${now});`,
    `INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms)
      VALUES(${sql(ids.foreignTenantId)},${sql(ids.foreignTenantId)},'Foreign E2E Tenant','active',${now},${now});`,
    `INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms)
      VALUES(${sql(ids.foreignTenantId)},'petshop',${sql(ids.foreignClientId)},'Cliente Outro Tenant','active',${now},${now});`,
  ]

  d1Run(statements.join('\n'))
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const manifest = { schema: 'yuisync-legacy-regression/v1', runId, tenantId, ids, codes }
  await writeFile(DOMAIN_MANIFEST, JSON.stringify(manifest, null, 2), 'utf8')
  await exportEnv({
    E2E_TENANT_ID: tenantId,
    E2E_CLIENT_ID: ids.clientId,
    E2E_PET_SMALL_ID: ids.petSmallId,
    E2E_PET_MEDIUM_ID: ids.petMediumId,
    E2E_PET_CAT_ID: ids.petCatId,
    E2E_SERVICE_SMALL_ID: ids.serviceSmallId,
    E2E_SERVICE_SMALL_CODE: codes.small,
    E2E_SERVICE_MEDIUM_ID: ids.serviceMediumId,
    E2E_SERVICE_MEDIUM_CODE: codes.medium,
    E2E_SERVICE_LARGE_ID: ids.serviceLargeId,
    E2E_SERVICE_LARGE_CODE: codes.large,
    E2E_SERVICE_CAT_ID: ids.serviceCatId,
    E2E_SERVICE_CAT_CODE: codes.cat,
    E2E_PRODUCT_ID: ids.productId,
    E2E_PLAN_ID: ids.planId,
    E2E_SUBSCRIPTION_ID: ids.subscriptionId,
    E2E_PACKAGE_APPOINTMENT_ID: ids.packageAppointmentId,
    E2E_FOREIGN_TENANT_ID: ids.foreignTenantId,
    E2E_FOREIGN_CLIENT_ID: ids.foreignClientId,
  })
  console.log(JSON.stringify({ status: 'legacy-regression-domain-ready', tenant_id: tenantId, run_id: runId, package_appointment_id: ids.packageAppointmentId }))
}

async function cleanup() {
  let manifest
  try {
    manifest = JSON.parse(await readFile(DOMAIN_MANIFEST, 'utf8'))
  } catch {
    console.log(JSON.stringify({ status: 'legacy-regression-domain-cleanup-skipped', reason: 'manifest-missing' }))
    return
  }
  guardE2eTenant(manifest.tenantId)
  const foreignTenantId = String(manifest?.ids?.foreignTenantId || '')
  if (!foreignTenantId.startsWith('e2e-') || !foreignTenantId.endsWith('-foreign-tenant')) {
    throw new Error(`REFUSING_NON_E2E_FOREIGN_TENANT_CLEANUP:${foreignTenantId}`)
  }
  d1Run(`DELETE FROM clients WHERE tenant_id=${sql(foreignTenantId)}; DELETE FROM tenants WHERE id=${sql(foreignTenantId)};`)
  console.log(JSON.stringify({ status: 'legacy-regression-domain-cleaned', foreign_tenant_id: foreignTenantId }))
}

if (!['setup', 'cleanup'].includes(COMMAND)) {
  console.error('Usage: node scripts/migration/staging-legacy-regression-fixtures.mjs <setup|cleanup>')
  process.exit(2)
}

if (COMMAND === 'setup') await setup()
else await cleanup()