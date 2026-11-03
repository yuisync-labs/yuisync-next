import {writeFileSync} from 'node:fs'
// OpenAI list prices in USD per million tokens [input, output]; cached input is
// counted at the full price, so the tally errs on the expensive side.
const PRICES:Record<string,readonly [number,number]>={'gpt-4.1-mini':[0.4,1.6],'gpt-4.1-nano':[0.1,0.4],'gpt-4o-mini':[0.15,0.6]}
// The most one more call may cost (about 20k tokens in, 1k out on gpt-4.1-mini).
const NEXT_CALL_USD=0.01
// Every paid call of a live run goes through here: it adds up what OpenAI
// reports, writes the tally to spend.json, and refuses the next call once it
// could pass the budget kai set (see .github/luna-spend-ledger.json).
export function openAIBudget(dir:string,budgetUsd:number,key:string){
 let spent=0,stopped:string|null=null,calls=0
 const models:Record<string,{input:number;output:number;usd:number}>={}
 const save=()=>writeFileSync(dir+'spend.json',JSON.stringify({budget_usd:budgetUsd,spent_usd:Number(spent.toFixed(6)),calls,models,stopped},null,1))
 save()
 const stop=(code:string)=>{stopped=code;save();return Response.json({code},{status:429})}
 return {
  stopped:()=>stopped,
  spent:()=>spent,
  async call(path:string,body:string){
   if(stopped)return Response.json({code:stopped},{status:429})
   const model=String((JSON.parse(body) as {model?:unknown}).model??''),price=PRICES[model]
   if(!price)return stop('MODEL_PRICE_UNKNOWN:'+model)
   if(spent+NEXT_CALL_USD>budgetUsd)return stop('BUDGET_EXHAUSTED')
   const r=await fetch((process.env.OPENAI_BASE_URL??'https://api.openai.com')+path,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(150000)})
   const text=await r.text()
   calls++
   // Streamed and plain responses both carry prompt_tokens/completion_tokens once.
   const found=[...text.matchAll(/"prompt_tokens":\s*(\d+)[\s\S]*?"completion_tokens":\s*(\d+)/g)]
   const input=found.length?found.reduce((n,m)=>n+Number(m[1]),0):Math.ceil(body.length/3),output=found.length?found.reduce((n,m)=>n+Number(m[2]),0):1000
   const usd=(input*price[0]+output*price[1])/1e6
   spent+=usd
   const m=models[model]??={input:0,output:0,usd:0};m.input+=input;m.output+=output;m.usd+=usd
   if(r.status===429&&/insufficient_quota|billing/i.test(text))stopped='OPENAI_QUOTA_EXHAUSTED'
   save()
   return new Response(text,{status:r.status,headers:{'content-type':r.headers.get('content-type')??'application/json'}})
  },
 }
}
