import { lunaNow } from './clock'
import type { LunaExecutionContext,LunaToolResult } from './contracts'
import type { Fact } from './factualResponse'
import { loadOperationalState } from './operationalState'
export type PresentedOption={id:string;kind:'product'|'service'|'pet'|'slot'|'transport';label:string;observedAtMs:number}
export type ConversationMemory={schemaVersion:1;options:PresentedOption[];question:string|null;targetOperationId:string|null;focus:string|null;paused:string[];summary:string}
const empty=():ConversationMemory=>({schemaVersion:1,options:[],question:null,targetOperationId:null,focus:null,paused:[],summary:''})
export async function loadConversationMemory(db:D1Database,ctx:LunaExecutionContext):Promise<ConversationMemory>{
 const row=await db.prepare(`SELECT context_json FROM luna_conversation_memory WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId).first<{context_json:string}>()
 if(!row)return empty()
 const value=JSON.parse(row.context_json) as ConversationMemory
 if(value.schemaVersion!==1||!Array.isArray(value.options)||value.options.length>40||value.options.some(o=>!o||typeof o.id!=='string'||!['product','service','pet','slot','transport'].includes(o.kind)||typeof o.label!=='string'||!Number.isSafeInteger(o.observedAtMs))||!Array.isArray(value.paused)||value.paused.some(id=>typeof id!=='string')||typeof value.summary!=='string'||[value.focus,value.question,value.targetOperationId].some(v=>v!==null&&typeof v!=='string'))throw new Error('CONVERSATION_MEMORY_UNKNOWN')
 return value
}
export async function prepareResponseMemory(db:D1Database,ctx:LunaExecutionContext,reply:string,facts:readonly Fact[],question:string|null):Promise<void>{
 const prior=await loadConversationMemory(db,ctx)
 const row=await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId).first<{state_json:string}>()
 const state=loadOperationalState(row!.state_json)
 const decision=await db.prepare(`SELECT decision_json FROM luna_turn_decisions WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND source_message_id=?4`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId,ctx.sourceMessageId).first<{decision_json:string}>()
 const requestedFocus=decision?JSON.parse(decision.decision_json).focus:null
 const focus=typeof requestedFocus==='string'&&Object.hasOwn(state.operations,requestedFocus)?requestedFocus:state.focus
 const shown=facts.filter(f=>f.reference&&reply.includes(f.text)).sort((a,b)=>reply.indexOf(a.text)-reply.indexOf(b.text))
 // A new list replaces only its kind, not the options of parallel operations.
 const replacedKinds=new Set(shown.map(f=>f.reference!.kind))
 const options=[...prior.options.filter(o=>!replacedKinds.has(o.kind)),...shown.map(f=>f.reference!)].slice(-40)
 const operations=Object.values(state.operations)
 const summary=JSON.stringify({focus,operations:operations.map(d=>({id:d.id,kind:d.kind,status:d.status,version:d.version,fields:d.fields,items:d.items})),question})
 const memory:ConversationMemory={schemaVersion:1,options,question,targetOperationId:question?focus:null,focus,paused:operations.filter(d=>d.status==='paused').map(d=>d.id),summary}
 await db.prepare(`INSERT INTO luna_response_drafts VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(tenant_id,module_id,conversation_id,source_message_id) DO UPDATE SET reply_text=excluded.reply_text,context_json=excluded.context_json,created_at_ms=excluded.created_at_ms`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId,ctx.sourceMessageId,reply,JSON.stringify(memory),lunaNow(ctx)).run()
}
export async function acceptResponseMemory(db:D1Database,ctx:LunaExecutionContext,messageId:string,reply:string,presentedAt=lunaNow(ctx)):Promise<void>{
 const candidate=await db.prepare(`SELECT context_json,reply_text FROM luna_response_drafts WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND source_message_id=?4`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId,ctx.sourceMessageId).first<{context_json:string;reply_text:string}>()
 if(!candidate)return
 if(candidate.reply_text!==reply)throw new Error('RESPONSE_PRESENTATION_MISMATCH')
 const memory=JSON.parse(candidate.context_json) as ConversationMemory
 await db.batch([
  db.prepare(`INSERT INTO luna_conversation_memory VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(tenant_id,module_id,conversation_id) DO UPDATE SET outbound_message_id=excluded.outbound_message_id,context_json=excluded.context_json,presented_at_ms=excluded.presented_at_ms WHERE excluded.presented_at_ms>=luna_conversation_memory.presented_at_ms`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId,messageId,candidate.context_json,presentedAt),
  db.prepare(`UPDATE luna_conversations SET summary_text=?4 WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND EXISTS(SELECT 1 FROM luna_conversation_memory WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3 AND outbound_message_id=?5)`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId,memory.summary,messageId),
 ])
}
export async function resolveContextReference(db:D1Database,ctx:LunaExecutionContext,args:Record<string,unknown>):Promise<LunaToolResult>{
 const memory=await loadConversationMemory(db,ctx),options=memory.options.filter(o=>o.kind===args.kind)
 let selected:PresentedOption|undefined
 if(args.selection==='ordinal')selected=options[Number(args.ordinal)-1]
 if(args.selection==='single'&&options.length===1)selected=options[0]
 if(args.selection==='other'){
  const row=await db.prepare(`SELECT state_json FROM luna_conversations WHERE tenant_id=?1 AND module_id=?2 AND conversation_id=?3`).bind(ctx.tenantId,ctx.moduleId,ctx.conversationId).first<{state_json:string}>()
  const state=loadOperationalState(row!.state_json),draft=state.operations[String(args.operation_id??memory.focus)]
  const field=args.kind==='pet'?'pet_id':args.kind==='slot'?'scheduled_at':args.kind==='transport'?'transport_mode':null
  const selectedIds=field&&draft?.fields[field]?[draft.fields[field]]:draft?.items.map(i=>i.id)??[]
  const previous=options.filter(o=>selectedIds.includes(o.id))
  if(previous.length===1&&options.length===2)selected=options.find(o=>o.id!==previous[0].id)
 }
 if(!selected)return{ok:false,code:'CONTEXT_REFERENCE_AMBIGUOUS',retryable:false,missing_fields:['choice']}
 return{ok:true,data:{option:selected,source:'accepted_outbound',requires_revalidation:true}}
}
