import { expect } from 'vitest'
import { runLunaTurn } from '../../../src/luna/runLunaTurn'
import { recordProposalPresentation } from '../../../src/luna/proposalPresentation'
import { createD1TurnJournal } from '../../../src/luna/turnJournal'
import type { LunaMessage,LunaProviderResponse } from '../../../src/luna/contracts'
import type { Command } from './designedRuntimeHarness'
import { scenarioDB as db } from './designedRuntimeHarness'
export async function peerRuntime(input:{tenantId:string;conversationId:string;phone:string;step:number;message:string;command:Command;now:number;expectedFailures?:string[]}){
 // Auxiliary sessions are part of the designed race/fault branch, not an
 // unrestricted backdoor around each scenario's tool contract.
 expect(['prepare_product_order','prepare_appointment','prepare_appointment_cancellation','commit_confirmed_proposal']).toContain(input.command.name)
 const ctx={tenantId:input.tenantId,moduleId:'petshop' as const,conversationId:input.conversationId,customerAddress:input.phone,phoneNumberId:'fixture-no-whatsapp',sourceMessageId:`${input.conversationId}-in-${input.step}`,traceId:`peer-${input.conversationId}-${input.step}`,executionMode:'fixture' as const}
 await db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4) ON CONFLICT DO NOTHING`).bind(ctx.tenantId,ctx.conversationId,`${ctx.customerAddress}-${ctx.conversationId}`,input.now).run()
 await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer',?4,?5)`).bind(ctx.tenantId,ctx.sourceMessageId,ctx.conversationId,input.message,input.now).run()
 let sent=false
 const failures:string[]=[]
 const provider={model:'offline-scripted-provider',async complete(i:{messages:readonly LunaMessage[]}):Promise<LunaProviderResponse & {requestLimit:number}>{
  const results=i.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content!))
  for(const r of results)if(!r.ok)failures.push(r.code)
  const toolCalls=sent?[]:[{id:'peer-call',type:'function' as const,function:{name:input.command.name,arguments:JSON.stringify(input.command.args)}}];sent=true
  const fact=results.some(r=>r.ok&&r.data?.operation_id)?['peer-call:result']:[]
  return{content:toolCalls.length?null:JSON.stringify({opening:'acknowledge',facts:fact,question:'none'}),toolCalls,usage:{promptTokens:10,completionTokens:10},rateLimit:{remainingRequests:900,remainingTokens:7000,resetRequests:null,resetTokens:null},requestLimit:1000}
 }}
 const result=await runLunaTurn({database:db,context:ctx,provider,journal:createD1TurnJournal(db,ctx,'designed-final-durable-v1')})
 expect(result.errorCode,JSON.stringify({input,result,failures})).toBeNull()
 for(const code of failures)expect(input.expectedFailures??[],JSON.stringify({input,failures})).toContain(code)
 const outbound=`${input.conversationId}-out-${input.step}`
 await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(ctx.tenantId,outbound,ctx.conversationId,result.reply,input.now+1).run()
 await recordProposalPresentation(db,ctx,result.proposalIds,outbound)
 return{result,proposal:result.proposalIds[0]?{proposal_id:result.proposalIds[0],proposal_version:1}:null}
}
