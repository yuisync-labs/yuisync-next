import type { LunaToolDefinition, LunaToolResult } from './contracts'
import type { OperationalState } from './operationalState'
import { validateFactualResponse, type Fact } from './factualResponse'
import { matchesToolSchema } from './toolSchema'

// A turn ends through a read-only command, not arbitrary model prose. Values
// of operational facts remain server-owned; the model selects references.
export const FINISH_TURN: LunaToolDefinition = {
  name: 'finish_turn',
  description: 'Encerra sem ação comercial. Declare intenção e IDs reais dos rascunhos. Compra/agendamento/cadastro exigem rascunho persistido; consulta usa information. fact_ids contém SOMENTE IDs do enum, nunca texto. question é o campo faltante ou none. social contém ligação não operacional (ex.: Claro, vamos por partes.), nunca nomes/valores/perguntas. Resumos comerciais são anexados pelo Worker. Nunca invente valores nem pergunte dados já explícitos.',
  parameters: {
    type:'object',additionalProperties:false,required:['intent','operation_ids','social','fact_ids','question'],
    properties:{
      intent:{type:'string',enum:['cart','booking','registration','information','social']},
      operation_ids:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:100}},
      social:{type:'array',maxItems:2,items:{type:'string',minLength:1,maxLength:240}},
      fact_ids:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:240}},
      question:{type:'string',enum:['none','date','period','pet','service','product','quantity','address','city','fulfillment','choice','clarify','machine','name','human']},
    },
  },
}

export function finishTurnDefinition(facts:readonly Fact[]):LunaToolDefinition {
  const properties=FINISH_TURN.parameters.properties as Record<string,Record<string,unknown>>
  return {...FINISH_TURN,parameters:{...FINISH_TURN.parameters,properties:{...properties,fact_ids:{...properties.fact_ids,...(facts.length?{items:{type:'string',enum:facts.map(f=>f.id)}}:{maxItems:0})}}}}
}

export function finishTurn(args: Record<string,unknown>, state: OperationalState, facts: readonly Fact[]): LunaToolResult<{reply:string}> {
  if(!matchesToolSchema(args,FINISH_TURN.parameters))return {ok:false,code:'TOOL_ARGUMENTS_INVALID',retryable:false}
  const intent=args.intent as string, ids=args.operation_ids as string[]
  if(new Set(ids).size!==ids.length || ids.some(id=>!Object.hasOwn(state.operations,id)))return {ok:false,code:'TURN_OPERATION_UNKNOWN',retryable:false}
  if(['cart','booking','registration'].includes(intent) && !ids.some(id=>state.operations[id].kind===intent))return {ok:false,code:'TURN_NOT_READY',retryable:false,validation_errors:[{field:'operation_ids',rule:'First query the real catalog/identity as needed and persist the requested draft with record_turn_decision. Reuse that draft ID; do not ask again for explicit data.'}]}
  const blocks=[...(args.social as string[]).map(text=>({kind:'social',value:text})),...(args.fact_ids as string[]).map(id=>({kind:'fact',value:id})),...(args.question==='none'?[]:[{kind:'question',value:args.question as string}])]
  const related=ids.map(id=>state.operations[id])
  for(const block of blocks){
    if(block.kind!=='question')continue
    if(block.value==='quantity' && related.some(d=>d.kind==='cart'&&d.items.length>0&&d.items.every(i=>i.quantity>0)))return {ok:false,code:'TURN_QUESTION_ALREADY_KNOWN',retryable:false,validation_errors:[{field:'blocks',rule:'Quantities already exist in the cart. Ask only a materially missing field.'}]}
    if(block.value==='fulfillment' && related.some(d=>d.kind==='cart'&&['counter','delivery'].includes(d.fields.fulfillment_type)))return {ok:false,code:'TURN_QUESTION_ALREADY_KNOWN',retryable:false,validation_errors:[{field:'blocks',rule:'Fulfillment is already recorded. Prepare the proposal if the draft is complete.'}]}
  }
  const payload={blocks:blocks.map(b=>b.kind==='fact'?{kind:'fact',id:b.value}:b.kind==='question'?{kind:'question',field:b.value}:{kind:'social',text:b.value})}
  const reply=validateFactualResponse(JSON.stringify(payload),facts)
  return reply ? {ok:true,data:{reply}} : {ok:false,code:'TURN_RESPONSE_INVALID',retryable:false,validation_errors:[{field:'blocks',rule:'Operational claims must reference exact verified fact IDs. Social blocks cannot contain product names, prices, quantities or questions. Use question blocks for missing fields.'}]}
}

export function operationalCapabilities(definitions: readonly LunaToolDefinition[], state: OperationalState, presentedKinds: readonly string[], context:{identityCurrent?:boolean;hasProposal?:boolean;hasAppointments?:boolean}={}): readonly LunaToolDefinition[] {
  const active=Object.values(state.operations).filter(d=>d.status==='active')
  return definitions.filter(d=> {
    // One model-facing draft writer. The original command remains in the
    // registry for compatibility; record_turn_decision includes all events.
    if(d.name==='update_operation_draft')return false
    if(d.name==='get_customer_context')return !context.identityCurrent
    if(d.name==='commit_confirmed_proposal'||d.name==='present_proposal')return !!context.hasProposal
    if(d.name==='prepare_appointment_reschedule'||d.name==='prepare_appointment_cancellation')return !!context.hasAppointments
    if(d.name==='prepare_customer_registration'||d.name==='prepare_pet_registration')return active.some(op=>op.kind==='registration'&&!!op.fields.pet_name&&!!op.fields.species)
    if(d.name==='resolve_context_reference')return presentedKinds.length>0
    if(d.name==='prepare_product_order')return active.some(op=>op.kind==='cart'&&op.items.length>0&&['counter','delivery'].includes(op.fields.fulfillment_type))
    if(d.name==='prepare_appointment')return active.some(op=>op.kind==='booking'&&op.items.length>0&&!!op.fields.pet_id&&!!op.fields.scheduled_at)
    return true
  })
}
