import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'
import {
  FISCAL_RULESET_VERSION,
  assertNoRawFiscalSecrets,
  classifySaleItems,
  fiscalItemId,
  normalizeCnpj,
  normalizeFiscalEnvironment,
  providerForDocument,
  readinessBlockers,
  schemaVersionForDocument,
  validateFiscalProfile,
  type FiscalDocumentType,
  type FiscalProfileLike,
  type FiscalSaleItem,
} from './fiscal/domain'
import { assertFiscalProductionDisabled } from './fiscal/providers'

type FiscalBindings = BetterAuthRuntimeBindings & { DB?: D1Database; APP_ENV?: string }
type AuthorizedScope = { principalId: string; tenantId: string; moduleId: 'petshop' }

type FiscalProfileRow = FiscalProfileLike & {
  tenant_id: string; module_id: string; legal_name: string; cnpj: string; state_registration: string | null
  municipal_registration: string | null; tax_regime: string; simples_nacional: number; municipality_ibge: string | null
  environment: string; certificate_secret_ref: string | null; certificate_fingerprint: string | null
  certificate_valid_until_ms: number | null; nfce_csc_secret_ref: string | null; nfce_csc_id: string | null
  nfce_series: number | null; nfe_series: number | null; nfse_series: string | null; created_at_ms: number; updated_at_ms: number
}

type FiscalRuleRow = {
  ruleset_version: string; document_type: FiscalDocumentType; ncm: string | null; cfop: string | null
  csosn: string | null; cst: string | null; service_code: string | null; nbs: string | null
  cclass_trib: string | null; cind_op: string | null; tax_data_json: string
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
function text(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
async function bodyOrEmpty(request: Request): Promise<Record<string, unknown>> { try { return object(await request.json()) } catch { return {} } }
function moduleAccess(raw: string | null): boolean { try { const p = JSON.parse(raw || '{}') as Record<string, unknown>; const v = p.petshop ?? p['*']; return v === true || typeof v === 'string' || Boolean(v && typeof v === 'object') } catch { return false } }

async function authorize(request: Request, bindings: FiscalBindings, tenantId: string): Promise<AuthorizedScope | Response> {
  if (!bindings.DB) return json({ code: 'DATABASE_NOT_CONFIGURED' }, 503)
  if (!ID.test(tenantId)) return json({ code: 'INVALID_TENANT' }, 400)
  const session = await getBetterAuthSession(request, bindings)
  const userId = text(session?.user?.id, 255)
  if (!userId) return json({ code: 'UNAUTHENTICATED' }, 401)
  const row = await bindings.DB.prepare(`
    SELECT p.id AS principal_id,m.role,m.module_permissions_json,m.status AS membership_status,t.status AS tenant_status
    FROM identity_principals p JOIN tenant_memberships m ON m.principal_id=p.id JOIN tenants t ON t.id=m.tenant_id
    WHERE p.provider='better-auth' AND p.subject=?1 AND p.status='active' AND m.tenant_id=?2 LIMIT 1
  `).bind(userId, tenantId).first<{ principal_id:string; role:string; module_permissions_json:string|null; membership_status:string; tenant_status:string }>()
  if (!row || row.membership_status !== 'active' || row.tenant_status !== 'active') return json({ code: 'FORBIDDEN' }, 403)
  if (row.role !== 'owner' && row.role !== 'admin' && !moduleAccess(row.module_permissions_json)) return json({ code: 'FORBIDDEN' }, 403)
  return { principalId: row.principal_id, tenantId, moduleId: 'petshop' }
}

function tenantFrom(request: Request, body?: Record<string, unknown>): string {
  return text(body?.tenantId ?? body?.tenant_id ?? request.headers.get('x-tenant-id') ?? new URL(request.url).searchParams.get('tenantId'), 160)
}

async function loadProfile(db: D1Database, tenantId: string): Promise<FiscalProfileRow | null> {
  return db.prepare(`SELECT * FROM fiscal_profiles WHERE tenant_id=?1 AND module_id='petshop' LIMIT 1`).bind(tenantId).first<FiscalProfileRow>()
}

function publicProfile(row: FiscalProfileRow | null) {
  if (!row) return null
  return { ...row, certificate_secret_ref: row.certificate_secret_ref ? '[configured]' : null, nfce_csc_secret_ref: row.nfce_csc_secret_ref ? '[configured]' : null }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function putProfile(request: Request, bindings: FiscalBindings): Promise<Response> {
  const body = await bodyOrEmpty(request)
  try { assertNoRawFiscalSecrets(body) } catch (error) { return json({ code: error instanceof Error ? error.message : 'RAW_FISCAL_SECRET_REJECTED' }, 400) }
  const tenantId = tenantFrom(request, body)
  const auth = await authorize(request, bindings, tenantId); if (auth instanceof Response) return auth
  const environment = text(body.environment, 32) || 'homologation'
  const cnpj = normalizeCnpj(body.cnpj)
  const taxRegime = text(body.taxRegime ?? body.tax_regime, 40)
  const profile: FiscalProfileLike = {
    cnpj,
    state_registration: text(body.stateRegistration ?? body.state_registration, 40) || null,
    municipal_registration: text(body.municipalRegistration ?? body.municipal_registration, 40) || null,
    tax_regime: taxRegime,
    simples_nacional: body.simplesNacional === true || body.simples_nacional === true || taxRegime === 'simples_nacional' ? 1 : 0,
    municipality_ibge: text(body.municipalityIbge ?? body.municipality_ibge, 7) || null,
    environment,
    certificate_secret_ref: text(body.certificateSecretRef ?? body.certificate_secret_ref, 255) || null,
    nfce_csc_secret_ref: text(body.nfceCscSecretRef ?? body.nfce_csc_secret_ref, 255) || null,
    nfce_csc_id: text(body.nfceCscId ?? body.nfce_csc_id, 20) || null,
  }
  try { validateFiscalProfile(profile); normalizeFiscalEnvironment(environment); assertFiscalProductionDisabled(environment) }
  catch (error) { return json({ code: error instanceof Error ? error.message : 'INVALID_FISCAL_PROFILE' }, 400) }
  const now = Date.now()
  await bindings.DB!.prepare(`
    INSERT INTO fiscal_profiles(
      tenant_id,module_id,legal_name,cnpj,state_registration,municipal_registration,tax_regime,simples_nacional,
      municipality_ibge,environment,certificate_secret_ref,certificate_fingerprint,certificate_valid_until_ms,
      nfce_csc_secret_ref,nfce_csc_id,nfce_series,nfe_series,nfse_series,created_at_ms,updated_at_ms
    ) VALUES(?1,'petshop',?2,?3,?4,?5,?6,?7,?8,'homologation',?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)
    ON CONFLICT(tenant_id,module_id) DO UPDATE SET legal_name=excluded.legal_name,cnpj=excluded.cnpj,
      state_registration=excluded.state_registration,municipal_registration=excluded.municipal_registration,tax_regime=excluded.tax_regime,
      simples_nacional=excluded.simples_nacional,municipality_ibge=excluded.municipality_ibge,environment='homologation',
      certificate_secret_ref=excluded.certificate_secret_ref,certificate_fingerprint=excluded.certificate_fingerprint,
      certificate_valid_until_ms=excluded.certificate_valid_until_ms,nfce_csc_secret_ref=excluded.nfce_csc_secret_ref,
      nfce_csc_id=excluded.nfce_csc_id,nfce_series=excluded.nfce_series,nfe_series=excluded.nfe_series,nfse_series=excluded.nfse_series,
      updated_at_ms=excluded.updated_at_ms
  `).bind(
    tenantId, text(body.legalName ?? body.legal_name, 200), cnpj, profile.state_registration, profile.municipal_registration,
    profile.tax_regime, profile.simples_nacional ? 1 : 0, profile.municipality_ibge, profile.certificate_secret_ref,
    text(body.certificateFingerprint ?? body.certificate_fingerprint, 128) || null, Number(body.certificateValidUntilMs ?? body.certificate_valid_until_ms) || null,
    profile.nfce_csc_secret_ref, profile.nfce_csc_id, Number(body.nfceSeries ?? body.nfce_series) || null,
    Number(body.nfeSeries ?? body.nfe_series) || null, text(body.nfseSeries ?? body.nfse_series, 32) || null, now,
  ).run()
  return json({ success: true, data: { profile: publicProfile(await loadProfile(bindings.DB!, tenantId)), transport: 'disabled' }, error: null })
}

async function getProfileOrReadiness(request: Request, bindings: FiscalBindings, readiness = false): Promise<Response> {
  const tenantId = tenantFrom(request)
  const auth = await authorize(request, bindings, tenantId); if (auth instanceof Response) return auth
  const profile = await loadProfile(bindings.DB!, tenantId)
  if (!readiness) return json({ success: true, data: { profile: publicProfile(profile), transport: 'disabled' }, error: null })
  return json({ success: true, data: {
    environment: 'homologation', transport: 'disabled', profile: publicProfile(profile),
    documents: {
      nfse: { provider: 'nfse_nacional', blockers: readinessBlockers(profile, 'nfse') },
      nfce: { provider: 'sefaz_mg', blockers: readinessBlockers(profile, 'nfce') },
      nfe: { provider: 'sefaz_mg', blockers: readinessBlockers(profile, 'nfe') },
    },
  }, error: null })
}

async function loadRule(db: D1Database, tenantId: string, item: FiscalSaleItem, now: number): Promise<FiscalRuleRow | null> {
  return db.prepare(`
    SELECT ruleset_version,document_type,ncm,cfop,csosn,cst,service_code,nbs,cclass_trib,cind_op,tax_data_json
    FROM fiscal_item_rules WHERE tenant_id=?1 AND module_id='petshop' AND item_type=?2 AND item_id=?3
      AND valid_from_ms<=?4 AND (valid_until_ms IS NULL OR valid_until_ms>?4)
    ORDER BY valid_from_ms DESC LIMIT 1
  `).bind(tenantId, item.item_type, fiscalItemId(item), now).first<FiscalRuleRow>()
}

async function issueSale(request: Request, bindings: FiscalBindings, saleId: string): Promise<Response> {
  const body = await bodyOrEmpty(request); const tenantId = tenantFrom(request, body)
  const auth = await authorize(request, bindings, tenantId); if (auth instanceof Response) return auth
  if (!ID.test(saleId)) return json({ code: 'INVALID_SALE' }, 400)
  const sale = await bindings.DB!.prepare(`SELECT id,status FROM sales WHERE tenant_id=?1 AND module_id='petshop' AND id=?2 LIMIT 1`).bind(tenantId, saleId).first<{id:string;status:string}>()
  if (!sale) return json({ code: 'SALE_NOT_FOUND' }, 404)
  if (sale.status === 'cancelled' || sale.status === 'refunded') return json({ code: 'SALE_NOT_FISCALLY_ISSUABLE' }, 409)
  const rows = await bindings.DB!.prepare(`
    SELECT position,item_type,product_id,service_id,item_name,quantity_milliunits,unit_price_cents,subtotal_cents
    FROM sale_items WHERE tenant_id=?1 AND module_id='petshop' AND sale_id=?2 ORDER BY position
  `).bind(tenantId, saleId).all<FiscalSaleItem>()
  if (!rows.results.length) return json({ code: 'SALE_ITEMS_NOT_FOUND' }, 409)
  const profile = await loadProfile(bindings.DB!, tenantId)
  const classified = classifySaleItems(rows.results)
  const now = Date.now(); const statements: D1PreparedStatement[] = []; const prepared: Array<{id:string;type:FiscalDocumentType;blockers:string[]}> = []
  for (const [type, items] of classified) {
    const rulePairs = await Promise.all(items.map(async (item) => ({ item, rule: await loadRule(bindings.DB!, tenantId, item, now) })))
    const missingRulePositions = rulePairs.filter((pair) => !pair.rule || pair.rule.document_type !== type).map((pair) => pair.item.position)
    const blockers = readinessBlockers(profile, type, missingRulePositions)
    const operationKey = `fiscal:${saleId}:${type}:${FISCAL_RULESET_VERSION}`
    const requestHash = await sha256(JSON.stringify({ tenantId, saleId, type, operationKey, items: items.map((item) => [item.position,item.subtotal_cents]) }))
    const documentId = `fd_${requestHash.slice(0, 32)}`
    const status = blockers.length ? 'awaiting_credentials' : 'pending'
    statements.push(bindings.DB!.prepare(`
      INSERT OR IGNORE INTO fiscal_documents(
        tenant_id,module_id,id,sale_id,operation_key,document_type,provider,environment,status,request_hash,
        schema_version,ruleset_version,readiness_json,created_at_ms,updated_at_ms
      ) VALUES(?1,'petshop',?2,?3,?4,?5,?6,'homologation',?7,?8,?9,?10,?11,?12,?12)
    `).bind(tenantId,documentId,saleId,operationKey,type,providerForDocument(type),status,requestHash,schemaVersionForDocument(type),FISCAL_RULESET_VERSION,JSON.stringify(blockers),now))
    for (const { item, rule } of rulePairs) {
      statements.push(bindings.DB!.prepare(`
        INSERT OR IGNORE INTO fiscal_document_items(
          tenant_id,module_id,fiscal_document_id,sale_id,sale_item_position,item_type,item_id,item_name,
          quantity_milliunits,unit_price_cents,subtotal_cents,fiscal_rule_snapshot_json,created_at_ms
        ) VALUES(?1,'petshop',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
      `).bind(tenantId,documentId,saleId,item.position,item.item_type,fiscalItemId(item),item.item_name,item.quantity_milliunits,item.unit_price_cents,item.subtotal_cents,JSON.stringify(rule ?? {}),now))
    }
    statements.push(bindings.DB!.prepare(`
      INSERT OR IGNORE INTO fiscal_events(tenant_id,module_id,id,fiscal_document_id,operation_key,event_type,payload_json,created_at_ms)
      VALUES(?1,'petshop',?2,?3,?4,'issuance_prepared',?5,?6)
    `).bind(tenantId,`fe_${requestHash.slice(0,32)}`,documentId,`${operationKey}:prepared`,JSON.stringify({status,blockers,transport:'disabled'}),now))
    prepared.push({ id: documentId, type, blockers })
  }
  await bindings.DB!.batch(statements)
  return json({ success: true, data: { sale_id: saleId, environment: 'homologation', transport: 'disabled', documents: prepared.map((doc) => ({ ...doc, status: doc.blockers.length ? 'awaiting_credentials' : 'pending', provider: providerForDocument(doc.type) })) }, error: null }, 202)
}

async function listSaleDocuments(request: Request, bindings: FiscalBindings, saleId: string): Promise<Response> {
  const tenantId = tenantFrom(request); const auth = await authorize(request, bindings, tenantId); if (auth instanceof Response) return auth
  const result = await bindings.DB!.prepare(`SELECT id,document_type,provider,environment,status,issuer_reference,access_key,protocol,schema_version,ruleset_version,readiness_json,authorized_at_ms,cancelled_at_ms,created_at_ms,updated_at_ms FROM fiscal_documents WHERE tenant_id=?1 AND module_id='petshop' AND sale_id=?2 ORDER BY created_at_ms,id`).bind(tenantId,saleId).all<Record<string,unknown>>()
  return json({ success: true, data: { documents: result.results.map((row) => ({ ...row, readiness: JSON.parse(String(row.readiness_json ?? '[]')), readiness_json: undefined })), transport: 'disabled' }, error: null })
}

export async function handleFiscalApiRequest(request: Request, bindings: FiscalBindings): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/fiscal/')) return null
  try { assertFiscalProductionDisabled(bindings.APP_ENV) } catch { return json({ code: 'FISCAL_PRODUCTION_DISABLED' }, 503) }
  if (url.pathname === '/api/fiscal/profile' && request.method === 'GET') return getProfileOrReadiness(request, bindings)
  if (url.pathname === '/api/fiscal/profile' && request.method === 'PUT') return putProfile(request, bindings)
  if (url.pathname === '/api/fiscal/readiness' && request.method === 'GET') return getProfileOrReadiness(request, bindings, true)
  const issue = url.pathname.match(/^\/api\/fiscal\/sales\/([^/]+)\/issue\/?$/)
  if (issue && request.method === 'POST') return issueSale(request, bindings, decodeURIComponent(issue[1]))
  const docs = url.pathname.match(/^\/api\/fiscal\/sales\/([^/]+)\/documents\/?$/)
  if (docs && request.method === 'GET') return listSaleDocuments(request, bindings, decodeURIComponent(docs[1]))
  return json({ code: 'NOT_FOUND' }, 404)
}
