import { z } from 'zod'
import { createLunaToolRegistry } from './toolRegistry'
import { LunaConversationRepository } from './conversationRepository'
import { isConversationCustomer } from './customerIdentity'
import { membershipAllows, type OperationMembership } from '../operationAuthorization'
import type { InternalChatJob } from './internalChatTurn'
import type { LunaExecutionContext, LunaToolResult } from './contracts'
import { preferencesSchema, applyPreferences, searchProducts, type Memory } from './thinkCatalog/catalog'
import { ensureCatalogProfiled } from './thinkCatalog/autoClassify'
import { resolveCatalogCategory, resolveVolumeDimension, searchOtherProducts } from './thinkCatalog/other-catalog'
import { supportedClassificationChanges, validateCatalogChanges, authorizedCatalogRemoval } from './thinkCatalog/validation'
import { ratingFromMessage, withdrawalMessage } from './thinkPolicy'

// Think has an explicit remove operation; null filters are redundant in its schema.
// Keep the original catalog schema (including null) for the preserved prototype.
const thinkFilters=z.object(Object.fromEntries(Object.entries(preferencesSchema.shape).map(([name,field])=>{
 const optional=field instanceof z.ZodOptional?field.unwrap():field
 const defined=optional instanceof z.ZodNullable?optional.unwrap():optional
 return [name,(field.description?defined.describe(field.description):defined).optional()]
})) as unknown as typeof preferencesSchema.shape).strict()
export const catalogInput = z.object({query:z.string().trim().min(1).max(100).optional().describe('Nome/família: cama, coleira, Bifinho. Espécie/peso/características ficam em filters.'),search_key:z.string().trim().min(1).max(80).default('catalogo').describe('Rótulo estável; português permitido.'), filters:thinkFilters.default({}),remove:z.array(preferencesSchema.keyof()).default([]),reset:z.boolean().default(false),offset:z.number().int().min(0).max(30).default(0)}).strict()
export function normalizeSearchKey(value:string){
 const key=value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\w-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'catalogo'
 return ['constructor','prototype','__proto__'].includes(key)?'busca_'+key:key
}
export const fail = (code:string):LunaToolResult=>({ok:false,code,retryable:false})

export async function validateThinkJob(db:D1Database,job:InternalChatJob,allowClosed=false,allowHandoff=false) {
  const c=job.context
  const principal=await db.prepare("SELECT id FROM identity_principals WHERE id=? AND status='active'").bind(job.principalId).first()
  const membership=await db.prepare("SELECT m.role,m.status,m.module_permissions_json,t.status tenant_status FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.principal_id=?").bind(c.tenantId,job.principalId).first<OperationMembership>()
  const admin=await db.prepare("SELECT principal_id FROM platform_administrators WHERE principal_id=? AND status='active'").bind(job.principalId).first()
  const tenant=await db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").bind(c.tenantId).first()
  if(!tenant||!principal||(!admin&&(!membership||!membershipAllows(membership,'petshop','operational'))))throw Error('FORBIDDEN')
  const thread=await db.prepare("SELECT status,channel,external_thread_id,context_json FROM chat_threads WHERE tenant_id=? AND module_id='petshop' AND id=?").bind(c.tenantId,c.conversationId).first<{status:string;channel:string;external_thread_id:string;context_json:string}>()
  const conversation=await db.prepare("SELECT status FROM luna_conversations WHERE tenant_id=? AND module_id='petshop' AND conversation_id=?").bind(c.tenantId,c.conversationId).first<{status:string}>()
  if(!thread||thread.channel!=='internal'||thread.external_thread_id.replace(/\D/g,'')!==c.customerAddress||(!allowHandoff&&(thread.status==='handoff'||conversation?.status==='handoff'))||(!allowClosed&&thread.status!=='open'))throw Error('LUNA_CHAT_BINDING_CHANGED')
  return thread
}

export async function thinkCatalogSearch(db:D1Database,c:LunaExecutionContext,before:Memory,input:z.infer<typeof catalogInput>,text:string) {
  const changes=Object.fromEntries(Object.entries(input.filters).filter(([,v])=>v!=null))
  const genericTreat=input.query&&/^petiscos?$/i.test(input.query.trim())&&(changes.productType==='treat'||changes.catalogCategory==='treat')
  if(input.query&&!changes.productName&&!genericTreat)changes.productName=/^sach[eê]s?$/i.test(input.query)?'sach':input.query
  const checked=supportedClassificationChanges(before.preferences,changes,text,before.refinement?.field)
  for(const key of Object.keys(checked.discarded))delete changes[key]
  Object.assign(changes,checked.changes)
  validateCatalogChanges(before.preferences,changes,text,before.refinement?.field)
  await ensureCatalogProfiled(db,c.tenantId)
  await resolveCatalogCategory(db,changes,c.tenantId)
  await resolveVolumeDimension(db,changes,before.preferences,before.refinement?.field,c.tenantId)
  const removal=authorizedCatalogRemoval(before.preferences,input.remove,text)
  const memory=applyPreferences(before,{...changes,remove:removal.allowed.filter(k=>!(k in changes)),reset:input.reset,evidence:text},text,c.sourceMessageId)
  const result=memory.preferences.catalogCategory?await searchOtherProducts(db,memory.preferences,{offset:input.offset},memory.unrestricted,c.tenantId):await searchProducts(db,memory.preferences,{offset:input.offset},memory.unrestricted,c.tenantId)
  const products=[]
  for(const p of result.products){const stock=await db.prepare("SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=? AND module_id='petshop' AND product_id=?").bind(c.tenantId,p.id).first<{on_hand_milliunits:number;reserved_milliunits:number}>();products.push({...p,available_milliunits:stock?Math.max(0,stock.on_hand_milliunits-stock.reserved_milliunits):null,stock_confirmed:stock!==null})}
  return {memory:{...memory,lastProductIds:products.map(p=>p.id),lastOutOfStockProductIds:products.filter(p=>p.stock_confirmed&&p.available_milliunits===0).map(p=>p.id),refinement:'refinement' in result?result.refinement:undefined},result:{...result,products,...(Object.keys(checked.discarded).length?{ignored_filters:checked.discarded,ignored_filters_instruction:"Esses filtros inferidos pelo modelo JÁ foram descartados. Não precisa removê-los em outra chamada. Eles não comprovam características do produto."}:{}),...(removal.blocked.length?{retained_filters:removal.blocked}:{}),instruction:(result.status==='needs_refinement'?'Pergunte refinement: as opções dependem da escolha do cliente. Não preencha sozinho. ':'')+'Use apenas fatos retornados; campo omitido é desconhecido. Saldo disponível desconta reservas; stock_confirmed=false é desconhecido. Unidade de cobrança não confirmada. species_confirmation_required exige confirmar adequação. Sem resultado, preserve filtros; remoção exige consentimento explícito.'}}
}

export async function customerHistory(db:D1Database,c:LunaExecutionContext) {
  const customer=await createLunaToolRegistry(db).execute('get_customer_context',{},c)
  if(!customer.ok)return customer
  const id=(customer.data as {customer:{id:string}}).customer.id
  if(!await isConversationCustomer(db,c,id))return fail('CUSTOMER_SCOPE_DENIED')
  const orders=await db.prepare("SELECT id,created_at_ms,status,total_cents,fulfillment_type FROM sales WHERE tenant_id=? AND module_id='petshop' AND client_id=? AND status IN ('confirmed','completed') ORDER BY created_at_ms DESC LIMIT 5").bind(c.tenantId,id).all<Record<string,unknown>>()
  const items=[]
  for(const sale of orders.results){const r=await db.prepare("SELECT product_id,item_name,quantity_milliunits,unit_price_cents FROM sale_items WHERE tenant_id=? AND module_id='petshop' AND sale_id=? ORDER BY position LIMIT 12").bind(c.tenantId,sale.id).all();items.push({sale,results:r.results})}
  const appointments=await db.prepare("SELECT a.id,a.pet_id,p.name pet_name,a.scheduled_at_ms,a.status,s.service_id,s.service_name FROM appointments a LEFT JOIN pets p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.pet_id LEFT JOIN appointment_services s ON s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id WHERE a.tenant_id=? AND a.module_id='petshop' AND a.client_id=? AND a.status='completed' ORDER BY a.scheduled_at_ms DESC LIMIT 8").bind(c.tenantId,id).all()
  return {ok:true as const,data:{orders:items,appointments:appointments.results,instruction:'Histórico não confirma preço, estoque ou vaga atuais. Ausência de compra não comprova outro produto.'}}
}

export async function closeThinkConversation(db:D1Database,c:LunaExecutionContext,outcome:'completed'|'withdrawn',text:string) {
  if(outcome==='withdrawn'&&!withdrawalMessage(text))return fail('WITHDRAWAL_NOT_EXPLICIT')
  if(outcome==='completed'){
    // A registration alone is a step towards a booking or order, not a finished service.
    const done=await db.prepare("SELECT id FROM luna_proposals WHERE tenant_id=? AND module_id='petshop' AND conversation_id=? AND status='completed' AND operation_kind NOT IN ('customer_registration','pet_registration') LIMIT 1").bind(c.tenantId,c.conversationId).first()
    if(!done)return fail('OPERATION_NOT_COMPLETED')
    const {state}=await new LunaConversationRepository(db).loadState(c)
    const pending=await db.prepare("SELECT id FROM luna_proposals WHERE tenant_id=? AND module_id='petshop' AND conversation_id=? AND status IN ('awaiting_confirmation','executing') LIMIT 1").bind(c.tenantId,c.conversationId).first()
    if(pending||Object.values(state.operations).some(d=>d.status==='active'))return fail('OTHER_OPERATIONS_PENDING')
  }
  if(outcome==='withdrawn'){
    const executing=await db.prepare("SELECT id FROM luna_proposals WHERE tenant_id=? AND module_id='petshop' AND conversation_id=? AND status='executing' LIMIT 1").bind(c.tenantId,c.conversationId).first()
    if(executing)return fail('COMMIT_STATE_UNCERTAIN')
    const loaded=await new LunaConversationRepository(db).loadState(c),state=structuredClone(loaded.state)
    for(const draft of Object.values(state.operations))if(draft.status!=='cancelled'){draft.status='cancelled';draft.version++}
    state.version++;state.focus=null
    await db.batch([
      db.prepare("UPDATE luna_conversations SET state_json=?,version=version+1 WHERE tenant_id=? AND module_id='petshop' AND conversation_id=? AND version=?").bind(JSON.stringify(state),c.tenantId,c.conversationId,loaded.databaseVersion),
      db.prepare("UPDATE luna_proposals SET status='invalidated',updated_at_ms=? WHERE tenant_id=? AND module_id='petshop' AND conversation_id=? AND status='awaiting_confirmation' AND EXISTS(SELECT 1 FROM luna_conversations WHERE tenant_id=? AND conversation_id=? AND state_json=?)").bind(Date.now(),c.tenantId,c.conversationId,c.tenantId,c.conversationId,JSON.stringify(state)),
    ])
  }
  const result=await db.prepare("UPDATE chat_threads SET status='closed',closed_at_ms=?,updated_at_ms=?,context_json=json_set(json_remove(context_json,'$.think.rating_prompt_message'),'$.think.awaiting_rating',json('true'),'$.think.outcome',?) WHERE tenant_id=? AND module_id='petshop' AND id=? AND status='open'").bind(Date.now(),Date.now(),outcome,c.tenantId,c.conversationId).run()
  return result.meta.changes===1?{ok:true as const,data:{closed:true,request_rating:true}}:fail('CONVERSATION_ALREADY_CLOSED')
}

export function explicitRestockConsent(text:string){
  const normalized=text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
  return !/\bnao\b|\b(?:talvez|mas|se)\b/.test(normalized)&&/\b(?:pode (?:me )?avisar|me avisa|me avisem|quero (?:ser avisad[oa]|o aviso)|autorizo (?:o aviso|avisar))\b/.test(normalized)
}

export async function recordThinkRating(db:D1Database,c:LunaExecutionContext,score:number,text:string) {
  if(ratingFromMessage(text)!==score)return fail('RATING_NOT_EXPLICIT')
  const result=await db.prepare("UPDATE chat_threads SET csat_score=?,updated_at_ms=?,context_json=json_set(context_json,'$.think.awaiting_rating',json('false')) WHERE tenant_id=? AND module_id='petshop' AND id=? AND json_extract(context_json,'$.think.awaiting_rating')=1").bind(score,Date.now(),c.tenantId,c.conversationId).run()
  return result.meta.changes===1?{ok:true as const,data:{rating_saved:score}}:fail('RATING_NOT_REQUESTED')
}
