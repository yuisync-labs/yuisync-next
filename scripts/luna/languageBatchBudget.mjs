export const ACCOUNT='7eb4b696a14fde38c74edde4ebfcd1d9'
export const STAGING='yuisync-edge-api-staging'
export async function accountUsage(fetchImpl=fetch){
 if(process.env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT||!process.env.CLOUDFLARE_API_TOKEN)throw Error('STAGING_ACCOUNT_REQUIRED')
 const day=new Date().toISOString().slice(0,10),end=new Date(Date.parse(day)+86400000).toISOString()
 const query=`{viewer{accounts(filter:{accountTag:"${ACCOUNT}"}){aiInferenceAdaptiveGroups(limit:1,filter:{datetime_geq:"${day}T00:00:00Z",datetime_lt:"${end}"}){sum{totalNeurons}}}}}`
 const r=await fetchImpl('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)})
 const data=await r.json(),groups=data?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups
 if(!r.ok||data.errors?.length||!Array.isArray(groups))throw Error('DAILY_USAGE_UNAVAILABLE')
 const used=groups.reduce((n,g)=>n+Number(g.sum.totalNeurons),0)
 if(!Number.isFinite(used)||used<0||new Date().toISOString().slice(0,10)!==day)throw Error('DAILY_USAGE_INVALID')
 return {day,used,floor:Math.ceil(used)+100}
}
export function batchHeadroom(state,usage){
 if(state.day!==usage.day||state.limit!==9000||![state.used,state.reserved,usage.floor].every(n=>Number.isFinite(n)&&n>=0))throw Error('DAILY_COUNTER_INVALID')
 const floor=Math.max(state.used,usage.floor),cap=Math.min(1000,state.limit-floor)
 if(cap<100||state.reserved>cap)throw Error('DAILY_BUDGET_UNAVAILABLE')
 return {floor,cap,hold:state.limit-floor-cap}
}
