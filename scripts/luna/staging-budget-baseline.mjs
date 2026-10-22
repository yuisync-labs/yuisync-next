import {appendFile} from 'node:fs/promises'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
if(account!=='7eb4b696a14fde38c74edde4ebfcd1d9'||!token)throw Error('STAGING_ACCOUNT_REQUIRED')
const day=new Date().toISOString().slice(0,10),end=new Date(Date.parse(day)+86400000).toISOString()
const query=`{viewer{accounts(filter:{accountTag:"${account}"}){aiInferenceAdaptiveGroups(limit:1,filter:{datetime_geq:"${day}T00:00:00Z",datetime_lt:"${end}"}){sum{totalNeurons}}}}}`
const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query})})
const body=await response.json()
if(!response.ok||body.errors?.length||!body.data?.viewer?.accounts?.length)throw Error('DAILY_USAGE_UNAVAILABLE')
// Include a small reserve for delayed analytics. The runtime enforces a 9,000 ceiling.
const used=Math.ceil(body.data.viewer.accounts[0].aiInferenceAdaptiveGroups.reduce((sum,g)=>sum+Number(g.sum.totalNeurons),0))+100
if(!Number.isFinite(used)||used>=9000)throw Error('DAILY_FREE_BUDGET_UNAVAILABLE')
await appendFile(process.env.GITHUB_ENV,`LUNA_AI_BASELINE_DATE=${day}\nLUNA_AI_BASELINE_NEURONS=${used}\n`)
console.log(JSON.stringify({day,baselineNeurons:used,limit:9000,freeLimit:10000}))
