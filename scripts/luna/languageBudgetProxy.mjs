// Ephemeral test-only Worker. BUDGET references the existing staging namespace;
// there is no new daily counter, tenant data binding, or production binding.
const MODEL='@cf/zai-org/glm-4.7-flash'
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
export function modelReservation(input){
 const max=input?.max_tokens
 if(!Number.isInteger(max)||max<1||max>800)throw Error('OUTPUT_LIMIT_INVALID')
 return Math.ceil((JSON.stringify(input).length*4+512)*0.0055+max*0.0364)
}
async function boundedText(request,limit){
 const reader=request.body?.getReader();if(!reader)return ''
 const decoder=new TextDecoder();let bytes=0,text=''
 while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit){await reader.cancel();throw Error('TOO_LARGE')}text+=decoder.decode(next.value,{stream:true})}
 return text+decoder.decode()
}
async function authorized(request,env){
 if(typeof env.TEST_TOKEN!=='string'||env.TEST_TOKEN.length<40)return false
 const supplied=request.headers.get('authorization')??''
 const encode=new TextEncoder(),expected=encode.encode('Bearer '+env.TEST_TOKEN),actual=encode.encode(supplied)
 return expected.byteLength===actual.byteLength&&crypto.subtle.timingSafeEqual(expected,actual)
}
export default {async fetch(request,env){
 if(!await authorized(request,env))return json({code:'NOT_FOUND'},404)
 if(!env.BUDGET||!env.AI)return json({code:'BINDINGS_REQUIRED'},503)
 const budget=env.BUDGET.get(env.BUDGET.idFromName('workers-ai-account'))
 const call=(path,body)=>budget.fetch('https://budget'+path,body?{method:'POST',body:JSON.stringify(body)}:undefined)
 const path=new URL(request.url).pathname
 // Only the short-lived CI bearer can manage the reservation. Never log it.
 if(path==='/status'&&request.method==='GET'){
  const r=await call('/status');if(!r.ok)return r
  const s=await r.json(),active=env.BATCH_ACTIVE==='true',spent=s.used-Number(env.BATCH_START_USED)
  return json({...s,active,stop:!active||s.day!==env.BATCH_DAY||!Number.isFinite(spent)||spent>=Number(env.BATCH_MAX),spent})
 }
 if(['/reserve','/settle'].includes(path)&&request.method==='POST'){
  if(Number(request.headers.get('content-length')??0)>4096)return json({code:'TOO_LARGE'},413)
  let text;try{text=await boundedText(request,4096)}catch{return json({code:'TOO_LARGE'},413)}
  try{return await call(path,JSON.parse(text))}catch{return json({code:'INVALID_JSON'},400)}
 }
 if(path!=='/run'||request.method!=='POST')return json({code:'NOT_FOUND'},404)
 if(env.BATCH_ACTIVE!=='true')return json({code:'BATCH_DISABLED'},409)
 let text;try{text=await boundedText(request,250000)}catch{return json({code:'TOO_LARGE'},413)}
 let job;try{job=JSON.parse(text)}catch{return json({code:'INVALID_JSON'},400)}
 if(job.model!==MODEL||!job.input||typeof job.input!=='object')return json({code:'MODEL_INVALID'},400)
 const input={...job.input,stream:false,chat_template_kwargs:{...job.input.chat_template_kwargs,enable_thinking:false}}
 let bound;try{bound=modelReservation(input)}catch{return json({code:'OUTPUT_LIMIT_INVALID'},400)}
 const before=await call('/status');if(!before.ok)return before
 const state=await before.json(),start=Number(env.BATCH_START_USED),cap=Number(env.BATCH_MAX)
 if(state.day!==env.BATCH_DAY||!Number.isFinite(start)||!Number.isFinite(cap)||cap<=0||cap>1000||state.used-start+bound>cap)return json({code:'BATCH_BUDGET_EXHAUSTED'},429)
 // A shared hold reserves all daily headroom above start+cap. The daily DO
 // serializes reservations, including simultaneous pilot calls/compaction.
 const reserved=await call('/reserve',{bound});if(!reserved.ok)return reserved
 const ticket=await reserved.json()
 if(ticket.day!==env.BATCH_DAY){await call('/settle',{...ticket,actual:0});return json({code:'DAY_CHANGED'},409)}
 let settled=false
 try{
  const result=await env.AI.run(MODEL,input)
  const usage=result?.usage,prompt=usage?.prompt_tokens,completion=usage?.completion_tokens
  const known=Number.isSafeInteger(prompt)&&prompt>=0&&Number.isSafeInteger(completion)&&completion>=0
  const actual=known?prompt*0.0055+completion*0.0364:undefined
  const receipt=await call('/settle',{...ticket,actual})
  if(!receipt.ok)throw Error('SETTLEMENT_FAILED')
  settled=true
  if(!known)return json({code:'AI_USAGE_UNKNOWN',charged:bound},502)
  if(actual>bound)return json({code:'RESERVATION_BOUND_EXCEEDED',actual,bound},502)
  return json(result)
 }catch{
  if(!settled)await call('/settle',ticket) // Unknown usage retains the entire bound.
  return json({code:'INFERENCE_UNCERTAIN'},502)
 }
}}
