import {DurableObject} from 'cloudflare:workers'
import {wrapLanguageModel,type LanguageModel,type LanguageModelMiddleware} from 'ai'

type BudgetEnv={LUNA_AI_DAILY_LIMIT?:string;LUNA_AI_BASELINE_DATE?:string;LUNA_AI_BASELINE_NEURONS?:string;LUNA_AI_BUDGET?:DurableObjectNamespace}
type Ticket={bound:number;actual?:number}
type Day={used:number;reserved:number;tickets:Record<string,Ticket>}
import {thinkNeurons as neurons} from './thinkPolicy'
export class LunaAiBudget extends DurableObject<BudgetEnv>{
 async fetch(request:Request){
  const path=new URL(request.url).pathname,now=new Date().toISOString().slice(0,10),limit=Number(this.env.LUNA_AI_DAILY_LIMIT??9000)
  if(!Number.isFinite(limit)||limit<=0||limit>9000)return Response.json({code:'AI_BUDGET_CONFIG_INVALID'},{status:503})
  const input=request.method==='POST'?await request.json() as {bound?:number;id?:string;day?:string;actual?:number}:{}
  const day=path==='/settle'?input.day:now
  if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))return Response.json({code:'AI_BUDGET_INVALID'},{status:400})
  return this.ctx.storage.transaction(async tx=>{
   const state=await tx.get<Day>(day)??{used:day===this.env.LUNA_AI_BASELINE_DATE?Number(this.env.LUNA_AI_BASELINE_NEURONS):0,reserved:0,tickets:{}}
   if(!Number.isFinite(state.used)||state.used<0)return Response.json({code:'AI_BUDGET_BASELINE_INVALID'},{status:503})
   if(path==='/reserve'){
    const bound=input.bound
    if(typeof bound!=='number'||!Number.isFinite(bound)||bound<=0)return Response.json({code:'AI_BUDGET_INVALID'},{status:400})
    if(state.used+state.reserved+bound>limit)return Response.json({code:'DAILY_AI_BUDGET_EXHAUSTED',day,used:state.used,reserved:state.reserved,limit},{status:429})
    const id=crypto.randomUUID();state.tickets[id]={bound};state.reserved+=bound;await tx.put(day,state)
    return Response.json({id,day,bound})
   }
   if(path==='/settle'){
    const ticket=input.id&&state.tickets[input.id]
    if(!ticket)return Response.json({code:'AI_BUDGET_TICKET_NOT_FOUND'},{status:404})
    if(ticket.actual===undefined){
     // Unknown usage/transport errors keep the entire reservation charged.
     const actual=typeof input.actual==='number'&&Number.isFinite(input.actual)&&input.actual>=0?input.actual:ticket.bound
     state.reserved-=ticket.bound;state.used+=actual;ticket.actual=actual;await tx.put(day,state)
    }
    return Response.json({ok:true,used:state.used,reserved:state.reserved,limit})
   }
   if(path==='/status')return Response.json({day,used:state.used,reserved:state.reserved,limit})
   return Response.json({code:'NOT_FOUND'},{status:404})
  })
 }
}
// Neurons still free today, or null where no daily budget is bound (production).
export async function dailyAiRemaining(env:BudgetEnv):Promise<number|null>{
 if(!env.LUNA_AI_BUDGET)return null
 const response=await env.LUNA_AI_BUDGET.get(env.LUNA_AI_BUDGET.idFromName('workers-ai-account')).fetch('https://budget/status')
 if(!response.ok)return 0
 const s=await response.json() as {used:number;reserved:number;limit:number}
 return Math.max(0,s.limit-s.used-s.reserved)
}
export function withDailyAiBudget(model:Exclude<LanguageModel,string>,env:BudgetEnv):LanguageModel{
 if(!env.LUNA_AI_BUDGET)throw Error('AI_DAILY_BUDGET_NOT_CONFIGURED')
 const budget=env.LUNA_AI_BUDGET.get(env.LUNA_AI_BUDGET.idFromName('workers-ai-account'))
 async function reserve(params:{maxOutputTokens?:number}){
  // UTF-8 upper bound on prompt/tool JSON plus framing reserve; no tokenizer guess.
  const maxOutput=params.maxOutputTokens
  if(!Number.isInteger(maxOutput)||!maxOutput||maxOutput<1||maxOutput>800)throw Error('AI_OUTPUT_BUDGET_INVALID')
  const bound=Math.ceil(neurons(JSON.stringify(params).length*4+512,maxOutput))
  const response=await budget.fetch('https://budget/reserve',{method:'POST',body:JSON.stringify({bound})})
  if(!response.ok)throw Error((await response.json() as {code:string}).code)
  return response.json() as Promise<{id:string;day:string;bound:number}>
 }
 async function settle(ticket:{id:string;day:string},usage?:{inputTokens:{total?:number};outputTokens:{total?:number}}){
  const actual=usage&&typeof usage.inputTokens.total==='number'&&typeof usage.outputTokens.total==='number'?neurons(usage.inputTokens.total,usage.outputTokens.total):undefined
  const response=await budget.fetch('https://budget/settle',{method:'POST',body:JSON.stringify({...ticket,actual})});if(!response.ok)throw Error('AI_BUDGET_SETTLEMENT_FAILED')
 }
 const middleware:LanguageModelMiddleware={
  wrapGenerate:async({doGenerate,params})=>{const ticket=await reserve(params);try{const result=await doGenerate();await settle(ticket,result.usage);return result}catch(error){await settle(ticket);throw error}},
  wrapStream:async({doStream,params})=>{
   const ticket=await reserve(params)
   try{
    const result=await doStream();let finished=false
    return {...result,stream:result.stream.pipeThrough(new TransformStream({
     async transform(chunk,controller){if(chunk.type==='finish'){await settle(ticket,chunk.usage);finished=true}controller.enqueue(chunk)},
     async flush(){if(!finished)await settle(ticket)},
    }))}
   }catch(error){await settle(ticket);throw error}
  },
 }
 return wrapLanguageModel({model,middleware})
}
