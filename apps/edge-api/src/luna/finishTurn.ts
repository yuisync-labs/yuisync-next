import type { LunaToolDefinition, LunaToolResult } from './contracts'
import type { OperationalState } from './operationalState'
import { validateFactualResponse, type Fact } from './factualResponse'
import { matchesToolSchema } from './toolSchema'

// A turn ends through a read-only command, not arbitrary model prose. Values
// of operational facts remain server-owned; the model selects references.
export const FINISH_TURN: LunaToolDefinition = {
  name: 'finish_turn',
  description: 'Encerra o turno sem ação comercial. Declare a intenção e os IDs reais dos rascunhos relacionados. Compra/agendamento/cadastro exigem rascunho persistido antes de encerrar; consulta informativa usa information. Não substitua catálogo por pergunta repetida. Blocos: fact usa ID verificado, question usa campo faltante, social só ligação não operacional (ex.: Claro, vamos por partes.). Nunca invente valores. Se TURN_NOT_READY, conclua a etapa indicada usando tools.',
  parameters: {
    type:'object',additionalProperties:false,required:['intent','operation_ids','blocks'],
    properties:{
      intent:{type:'string',enum:['cart','booking','registration','information','social']},
      operation_ids:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:100}},
      blocks:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,required:['kind','value'],properties:{kind:{type:'string',enum:['social','fact','question']},value:{type:'string',minLength:1,maxLength:240,description:'fact: ID exato do contexto verificado. question: date, period, pet, service, product, quantity, address, city, fulfillment, choice, clarify, machine, name ou human. social: ligação não operacional, sem nomes/valores/perguntas; por exemplo Certo! ou Vamos continuar.'}}}},
    },
  },
}

export function finishTurn(args: Record<string,unknown>, state: OperationalState, facts: readonly Fact[]): LunaToolResult<{reply:string}> {
  if(!matchesToolSchema(args,FINISH_TURN.parameters))return {ok:false,code:'TOOL_ARGUMENTS_INVALID',retryable:false}
  const intent=args.intent as string, ids=args.operation_ids as string[]
  if(new Set(ids).size!==ids.length || ids.some(id=>!Object.hasOwn(state.operations,id)))return {ok:false,code:'TURN_OPERATION_UNKNOWN',retryable:false}
  if(['cart','booking','registration'].includes(intent) && !ids.some(id=>state.operations[id].kind===intent))return {ok:false,code:'TURN_NOT_READY',retryable:false,validation_errors:[{field:'operation_ids',rule:'First query the real catalog/identity as needed and persist the requested draft with record_turn_decision. Reuse that draft ID; do not ask again for explicit data.'}]}
  const blocks=args.blocks as {kind:string;value:string}[]
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

export function operationalCapabilities(definitions: readonly LunaToolDefinition[], state: OperationalState, presentedKinds: readonly string[]): readonly LunaToolDefinition[] {
  const active=Object.values(state.operations).filter(d=>d.status==='active')
  return definitions.filter(d=> {
    if(d.name==='resolve_context_reference')return presentedKinds.length>0
    if(d.name==='prepare_product_order')return active.some(op=>op.kind==='cart'&&op.items.length>0&&['counter','delivery'].includes(op.fields.fulfillment_type))
    if(d.name==='prepare_appointment')return active.some(op=>op.kind==='booking'&&op.items.length>0&&!!op.fields.pet_id&&!!op.fields.scheduled_at)
    return true
  })
}
