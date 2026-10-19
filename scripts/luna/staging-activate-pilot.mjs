// Called only after the disposable native-AI certification succeeds.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
if(account!=='7eb4b696a14fde38c74edde4ebfcd1d9'||!token)throw Error('STAGING_ACCOUNT_REQUIRED')
const url=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/yuisync-edge-api-staging/settings`
const headers={authorization:`Bearer ${token}`}
const current=await fetch(url,{headers}).then(r=>r.json())
if(!current.success)throw Error('STAGING_SETTINGS_READ_FAILED')
const bindings=current.result.bindings
if(!bindings.some(b=>b.name==='LUNA_RUNTIME'&&b.text==='think'))throw Error('STAGING_THINK_NOT_DEPLOYED')
const next=bindings.map(b=>b.name==='LUNA_THINK_TENANT_IDS'?{name:b.name,type:'plain_text',text:'29d6a509-8b35-47d0-ad19-7cee6f17328c'}:{name:b.name,type:'inherit'})
const form=new FormData();form.set('settings',new Blob([JSON.stringify({bindings:next})],{type:'application/json'}))
const result=await fetch(url,{method:'PATCH',headers,body:form}).then(r=>r.json())
if(!result.success)throw Error('STAGING_PILOT_ACTIVATION_FAILED')
const verified=await fetch(url,{headers}).then(r=>r.json())
if(!verified.success||verified.result.bindings.length!==bindings.length||!verified.result.bindings.some(b=>b.name==='LUNA_THINK_TENANT_IDS'&&b.text==='29d6a509-8b35-47d0-ad19-7cee6f17328c'))throw Error('STAGING_PILOT_SETTINGS_MISMATCH')
console.log(JSON.stringify({event:'luna.staging.pilot.enabled',tenant:'PetShop QuatroPatas',production:false}))
