import { createHash } from 'node:crypto'

export const AI_LAB_PROJECTION='phase8-ai-lab/v1'
const PAGE_SIZE=500
const MAX_PAGES=200

export class AiLabMigrationError extends Error {
  constructor(code,message='AI Lab migration failed.'){super(message);this.name='AiLabMigrationError';this.code=code}
}

function scopeOf(raw={}){
  const tenant_id=String(raw.tenant_id||'').trim();const module_id=String(raw.module_id||'').trim().toLowerCase()
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(tenant_id))throw new AiLabMigrationError('INVALID_TENANT_ID')
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(module_id))throw new AiLabMigrationError('INVALID_MODULE_ID')
  return{tenant_id,module_id}
}
function text(value){const v=value==null?'':String(value).trim();return v||null}
function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:Number(fallback)||0}
function epoch(value,fallback=0){if(value==null||value==='')return fallback;const parsed=typeof value==='number'?value:Date.parse(String(value));return Number.isFinite(parsed)?parsed:fallback}
function jsonText(value,fallback={}){if(typeof value==='string'){try{JSON.parse(value);return value}catch{return JSON.stringify(fallback)}}try{return JSON.stringify(value??fallback)}catch{return JSON.stringify(fallback)}}
function stable(rows,key='id'){return[...rows].sort((a,b)=>String(a?.[key]||'').localeCompare(String(b?.[key]||'')))}

export function projectAiLabSnapshot(source,{tenantId,moduleId,now=Date.now()}={}){
  const scope=scopeOf({tenant_id:tenantId,module_id:moduleId});const tables=source?.tables&&typeof source.tables==='object'?source.tables:{}
  const companies=Array.isArray(tables.companies)?tables.companies:[];const companyIds=new Set(companies.map((row)=>String(row.id||'')))
  const nicheIds=new Set(companies.map((row)=>String(row.niche_id||'')).filter(Boolean))
  const niches=stable((Array.isArray(tables.niches)?tables.niches:[]).filter((row)=>nicheIds.has(String(row.id||''))).map((row)=>({
    id:String(row.id),name:String(row.name||''),base_prompt:String(row.base_prompt||''),created_at_ms:epoch(row.created_at,now),updated_at_ms:epoch(row.updated_at??row.created_at,now),
  })))
  const projectedCompanies=stable(companies.map((row)=>({
    tenant_id:scope.tenant_id,module_id:scope.module_id,id:String(row.id),niche_id:String(row.niche_id),name:String(row.name||''),system_prompt:String(row.system_prompt||''),bot_name:String(row.bot_name||'Yui'),
    temperature_milli:Math.max(0,Math.min(2000,Math.round(number(row.temperature,.5)*1000))),model_name:String(row.model_name||'gpt-4o-mini'),welcome_message:text(row.welcome_message),kb_namespace:text(row.kb_namespace),
    status:row.is_active===false?'inactive':'active',schedule_free_status:String(row.schedule_free_status||'available'),schedule_booked_status:String(row.schedule_booked_status||'booked'),created_at_ms:epoch(row.created_at,now),updated_at_ms:epoch(row.updated_at??row.created_at,now),
  })))
  const promptVersions=stable((Array.isArray(tables.prompt_versions)?tables.prompt_versions:[]).filter((row)=>companyIds.has(String(row.company_id||''))).map((row)=>({
    tenant_id:scope.tenant_id,module_id:scope.module_id,id:String(row.id),company_id:String(row.company_id),layer:String(row.layer||'company'),content:String(row.content||''),version:Math.max(1,Math.round(number(row.version,1))),is_active:row.is_active===false?0:1,
    changed_by:text(row.changed_by),change_note:text(row.change_note),created_at_ms:epoch(row.created_at,now),
  })))
  const documents=stable((Array.isArray(tables.ai_training_documents)?tables.ai_training_documents:[]).filter((row)=>companyIds.has(String(row.company_id||''))).map((row)=>({
    tenant_id:scope.tenant_id,module_id:scope.module_id,id:String(row.id),company_id:String(row.company_id),title:String(row.title||'Documento'),object_key:text(row.storage_path),mime_type:text(row.mime_type),file_size:row.file_size==null?null:Math.max(0,Math.round(number(row.file_size))),
    content_text:text(row.content_text),tags_json:jsonText(row.tags,[]),status:String(row.status||'active'),metadata_json:jsonText(row.metadata,{}),uploaded_by:text(row.uploaded_by),created_at_ms:epoch(row.created_at,now),updated_at_ms:epoch(row.updated_at??row.created_at,now),
  })))
  const runs=stable((Array.isArray(tables.ai_playground_runs)?tables.ai_playground_runs:[]).filter((row)=>companyIds.has(String(row.company_id||''))).map((row)=>({
    tenant_id:scope.tenant_id,module_id:scope.module_id,id:String(row.id),company_id:String(row.company_id),created_by:text(row.created_by),customer_phone:String(row.customer_phone||'playground'),input_message:String(row.input_message||''),parsed_intent_json:jsonText(row.parsed_intent,{}),action:text(row.action),reply:text(row.reply),raw_response_json:jsonText(row.raw_response,{}),created_at_ms:epoch(row.created_at,now),
  })))
  return Object.freeze({projection:AI_LAB_PROJECTION,source:'supabase',scope,collections:{ai_niches:niches,ai_companies:projectedCompanies,ai_prompt_versions:promptVersions,ai_training_documents:documents,ai_playground_runs:runs}})
}

function baseUrl(value){let url;try{url=new URL(String(value||'').trim())}catch{throw new AiLabMigrationError('INVALID_SUPABASE_URL')}const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new AiLabMigrationError('INVALID_SUPABASE_URL');url.pathname='/';url.search='';url.hash='';return url}
async function fetchRows({base,key,table,params={},fetcher=fetch}){
  const rows=[];for(let page=0;page<MAX_PAGES;page+=1){const url=new URL(`/rest/v1/${table}`,base);url.searchParams.set('select','*');for(const[k,v]of Object.entries(params))if(v!=null)url.searchParams.set(k,String(v));url.searchParams.set('order','id.asc');const headers={accept:'application/json',apikey:key,authorization:`Bearer ${key}`,range:`${page*PAGE_SIZE}-${page*PAGE_SIZE+PAGE_SIZE-1}`};let response;try{response=await fetcher(url,{headers,redirect:'error'})}catch{throw new AiLabMigrationError('SUPABASE_UNAVAILABLE')}if(!response.ok){if(response.status===404)return[];throw new AiLabMigrationError('SUPABASE_READ_FAILED',`${table} read failed with HTTP ${response.status}.`)}const chunk=await response.json();if(!Array.isArray(chunk))throw new AiLabMigrationError('SUPABASE_RESPONSE_INVALID');rows.push(...chunk);if(chunk.length<PAGE_SIZE)return rows}throw new AiLabMigrationError('SUPABASE_PAGINATION_LIMIT_EXCEEDED')}

export async function extractSupabaseAiLabSnapshot({supabaseUrl,apiKey,scope:rawScope,fetcher=fetch}={}){
  const scope=scopeOf(rawScope),key=String(apiKey||'').trim();if(!key||/\s/.test(key))throw new AiLabMigrationError('INVALID_SUPABASE_API_KEY');const base=baseUrl(supabaseUrl)
  const companies=await fetchRows({base,key,table:'companies',params:{tenant_id:`eq.${scope.tenant_id}`,module_id:`eq.${scope.module_id}`},fetcher})
  const ids=companies.map((row)=>String(row.id||'')).filter(Boolean)
  const niches=await fetchRows({base,key,table:'niches',fetcher})
  if(!ids.length)return projectAiLabSnapshot({tables:{companies,niches,prompt_versions:[],ai_training_documents:[],ai_playground_runs:[]}}, {tenantId:scope.tenant_id,moduleId:scope.module_id})
  const companyFilter=`in.(${ids.join(',')})`
  const [prompt_versions,ai_training_documents,ai_playground_runs]=await Promise.all([
    fetchRows({base,key,table:'prompt_versions',params:{company_id:companyFilter},fetcher}),
    fetchRows({base,key,table:'ai_training_documents',params:{tenant_id:`eq.${scope.tenant_id}`,module_id:`eq.${scope.module_id}`},fetcher}),
    fetchRows({base,key,table:'ai_playground_runs',params:{tenant_id:`eq.${scope.tenant_id}`,module_id:`eq.${scope.module_id}`},fetcher}),
  ])
  return projectAiLabSnapshot({tables:{companies,niches,prompt_versions,ai_training_documents,ai_playground_runs}}, {tenantId:scope.tenant_id,moduleId:scope.module_id})
}

export function snapshotJson(snapshot){return JSON.stringify(snapshot)}
export function snapshotSha256(snapshot){return createHash('sha256').update(snapshotJson(snapshot)).digest('hex')}
export async function postAiLabSnapshot({edgeUrl,token,snapshot,fetcher=fetch}={}){
  const base=new URL(String(edgeUrl||''));if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new AiLabMigrationError('INVALID_EDGE_URL')
  const body=snapshotJson(snapshot),checksum=createHash('sha256').update(body).digest('hex')
  const response=await fetcher(new URL('/internal/migration/ai-lab',base),{method:'POST',headers:{'content-type':'application/json','x-yuisync-migration-token':String(token||''),'x-yuisync-migration-snapshot-sha256':checksum},body,redirect:'error'})
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new AiLabMigrationError(String(payload?.code||'EDGE_MIGRATION_FAILED'))
  return payload
}

export async function migrateAiLabTwice(options={}){
  const snapshot=await extractSupabaseAiLabSnapshot(options)
  const first=await postAiLabSnapshot({...options,snapshot})
  const second=await postAiLabSnapshot({...options,snapshot})
  if(Number(second.inserted_rows||0)!==0)throw new AiLabMigrationError('IDEMPOTENCY_FAILED')
  return Object.freeze({snapshot,checksum:snapshotSha256(snapshot),first,second})
}
