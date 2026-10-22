// Client-side transport only. The caller supplies an ephemeral bearer in memory;
// neither this module nor its errors persist or expose it. No automatic retries.
export async function createStagingHttpAdapter({baseUrl,token,sha,roundId,fetchImpl=fetch}) {
 const base=new URL(baseUrl)
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('CERTIFICATION_BASE_URL_INVALID')
 if(!token||!sha||!/^[a-zA-Z0-9_-]{1,100}$/.test(roundId??''))throw new Error('CERTIFICATION_HTTP_CONFIGURATION_INVALID')
 let budget=null
 async function call(path,body){
  let response
  try{
   response=await fetchImpl(new URL(`/internal/luna-certification/${path}`,base),{
    method:body?'POST':'GET',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    ...(body?{body:JSON.stringify({...body,roundId})}:{}),signal:AbortSignal.timeout(120000),
   })
  }catch{throw new Error('CERTIFICATION_TRANSPORT_UNCERTAIN')}
  // Do not print a server body: it could contain accidental secrets or PII.
  if(!response.ok)throw new Error(`CERTIFICATION_HTTP_${response.status}`)
  const accounting=response.headers.get('x-luna-cert-budget')
  if(accounting){try{budget=JSON.parse(accounting)}catch{throw new Error('CERTIFICATION_BUDGET_HEADER_INVALID')}}
  try{return await response.json()}catch{throw new Error('CERTIFICATION_RESPONSE_UNREADABLE')}
 }
 const capabilities=await call('capabilities',{})
 if(capabilities?.environment!=='staging'||capabilities.isolated!==true||capabilities.fixtureOnly!==true||capabilities.whatsappEnabled!==false||capabilities.releaseSha!==sha||!capabilities.model)throw new Error('CERTIFICATION_CAPABILITIES_MISMATCH')
 return {
  adapter:{...capabilities,configurationFingerprint:capabilities.fingerprint,
   // Upper reservation, not actual consumption. Every request must still be
   // metered on the Worker, including retry/fault branches.
   bound:async({scenario,turn})=>({calls:scenario.id===14&&turn===1?12:scenario.id===15&&turn===1?30:scenario.id===15&&turn>=2?12:6,tokens:100000,rowsRead:20000}),
   runTurn:({scenario,turn,message,idempotencyKey,limits})=>call('turn',{scenarioId:scenario.id,turn,message,sha,idempotencyKey,limits}),
   reconcileTurn:idempotencyKey=>call('reconcile',{idempotencyKey}),
   budget:()=>call('budget',{}),
   latestBudget:()=>budget,
  },
  store:{load:()=>call('store/load',{}),save:async(expectedVersion,state)=>{
   const result=await call('store/save',{expectedVersion,state})
   if(typeof result?.saved!=='boolean')throw new Error('CERTIFICATION_STORE_RESPONSE_INVALID')
   return result.saved
  }},
 }
}
