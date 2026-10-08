import { runLunaTurn } from './runLunaTurn'
import { GroqSdkProvider } from './providers/groqSdkProvider'
import { recordProposalPresentation } from './proposalPresentation'
import type { LunaExecutionContext } from './contracts'
import type { LunaTurnJournal } from './turnJournal'
import { LunaCheckpointError } from './turnJournal'
import { membershipAllows,type OperationMembership } from '../operationAuthorization'

export type LunaPlaygroundJob={kind:'playground';context:LunaExecutionContext;companyId:string;principalId:string;message:string;releaseSha:string}
type Bindings={DB?:D1Database;GROQ_API_KEY?:string;LUNA_MODEL?:string;LUNA_PLAYGROUND_ENABLED?:string;RELEASE_SHA?:string;LUNA_MAX_MODEL_CALLS_PER_TURN?:string;LUNA_MAX_TOOL_CALLS_PER_TURN?:string;LUNA_MAX_TOKENS_PER_TURN?:string}
const positive=(value:string|undefined,fallback:number)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):fallback

// Administrative playground uses exactly the native runtime/provider. It has
// no WhatsApp outbound path. Authorization is rechecked after every alarm.
export async function executeLunaPlaygroundJob(job:LunaPlaygroundJob,env:Bindings,journal:LunaTurnJournal){
 if(!env.DB||env.LUNA_PLAYGROUND_ENABLED!=='true'||job.releaseSha!==(env.RELEASE_SHA??'local'))throw new LunaCheckpointError('LUNA_PLAYGROUND_JOB_DISABLED_OR_CHANGED')
 const db=env.DB,ctx=job.context
 const principal=await db.prepare(`SELECT id FROM identity_principals WHERE id=?1 AND status='active' LIMIT 1`).bind(job.principalId).first()
 const tenant=await db.prepare(`SELECT status FROM tenants WHERE id=?1 LIMIT 1`).bind(ctx.tenantId).first<{status:string}>()
 const membership=await db.prepare(`SELECT role,status,module_permissions_json,'active' AS tenant_status FROM tenant_memberships WHERE tenant_id=?1 AND principal_id=?2 LIMIT 1`).bind(ctx.tenantId,job.principalId).first<OperationMembership>()
 const global=await db.prepare(`SELECT principal_id FROM platform_administrators WHERE principal_id=?1 AND status='active' LIMIT 1`).bind(job.principalId).first()
 if(!principal||tenant?.status!=='active'||(!global&&(!membership||!membershipAllows(membership,'petshop','administrative'))))throw new LunaCheckpointError('FORBIDDEN')
 await journal.run('playground-inbound',{message:job.message},async()=>{
  const now=Date.now()
  await db.batch([
   db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'internal',?2,'open',?3,?3,?3) ON CONFLICT(tenant_id,module_id,id) DO UPDATE SET last_message_at_ms=excluded.last_message_at_ms,updated_at_ms=excluded.updated_at_ms`).bind(ctx.tenantId,ctx.conversationId,now),
   db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(ctx.tenantId,ctx.sourceMessageId,ctx.conversationId,job.message,now),
  ]);return true
 })
 const provider=new GroqSdkProvider({apiKey:env.GROQ_API_KEY,model:env.LUNA_MODEL})
 const result=await runLunaTurn({database:db,provider,context:ctx,journal,maxModelCalls:positive(env.LUNA_MAX_MODEL_CALLS_PER_TURN,6),maxToolCalls:positive(env.LUNA_MAX_TOOL_CALLS_PER_TURN,10),maxTokens:positive(env.LUNA_MAX_TOKENS_PER_TURN,12000)})
 if(result.reply){
  const out=await journal.run('playground-outbound',{reply:result.reply},async()=>{const id=crypto.randomUUID();await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(ctx.tenantId,id,ctx.conversationId,result.reply,Date.now()).run();return id})
  await journal.run('playground-presentation',{out,proposals:result.proposalIds},async()=>{await recordProposalPresentation(db,ctx,result.proposalIds,out);return true})
 }
 const runId=await journal.run('playground-receipt',{result},async()=>{
  const id=crypto.randomUUID();await db.prepare(`INSERT INTO ai_playground_runs(tenant_id,module_id,id,company_id,created_by,customer_phone,input_message,parsed_intent_json,action,reply,raw_response_json,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`).bind(ctx.tenantId,id,job.companyId,job.principalId,ctx.customerAddress,job.message,JSON.stringify({proposal_ids:result.proposalIds,operation_ids:result.committedOperationIds}),result.status,result.reply??'',JSON.stringify({trace_id:ctx.traceId,usage:result.usage,model:provider.model,error_code:result.errorCode}),Date.now()).run();return id
 })
 return{status:result.status,errorCode:result.errorCode,data:{id:runId,action:result.status,reply:result.reply,proposal_ids:result.proposalIds,operation_ids:result.committedOperationIds,usage:result.usage,error_code:result.errorCode,trace_id:ctx.traceId}}
}
