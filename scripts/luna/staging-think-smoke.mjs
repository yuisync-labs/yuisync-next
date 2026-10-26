import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {chromium} from '@playwright/test'
const base='https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev'
assert.equal(process.env.YUISYNC_E2E_BASE_URL,base)
const fixture=JSON.parse(await readFile('.artifacts/staging-e2e/fixture.json','utf8'))
const tenant=fixture.tenantId,thread=fixture.runId+'-luna',customer=fixture.runId+'-customer',product=fixture.runId+'-racao'
assert(tenant.startsWith('e2e-')&&tenant.endsWith('-tenant'))
const hours=Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),[{open:'00:00',close:'23:59'}]]))
const settings=JSON.stringify({petbot_timezone:'America/Sao_Paulo',store_business_hours:hours,petbot_business_hours:hours})
const q=s=>`'${String(s).replaceAll("'","''")}'`,now=Date.now()
function db(sql){
 const out=execFileSync('npx',['wrangler','d1','execute','DB','--env','staging','--remote','--json','--command',sql],{cwd:'apps/edge-api',encoding:'utf8',maxBuffer:8e6})
 return JSON.parse(out)[0].results
}
db(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,version,updated_at_ms) VALUES(${q(tenant)},'petshop',${q(settings)},1,${now}) ON CONFLICT(tenant_id,module_id) DO UPDATE SET data_json=excluded.data_json;
INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(${q(tenant)},'petshop',${q(customer)},'Maria Staging','5532999990811','active',${now},${now});
INSERT INTO chat_threads(tenant_id,module_id,id,client_id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(${q(tenant)},'petshop',${q(thread)},${q(customer)},'internal','5532999990811','open',${now},${now});
INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(${q(tenant)},'petshop',${q(product)},'Ração A 15 kg',9000,'active',${now},${now});
INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(${q(tenant)},'petshop',${q(product)},10000,0,0,1,${now});
INSERT INTO catalog_product_attributes(tenant_id,module_id,product_id,product_type,brand_code,brand_label,life_stage,sale_form,package_weight_grams,search_enabled,review_state,evidence_json,revision,created_at_ms) VALUES(${q(tenant)},'petshop',${q(product)},'feed','quatree','Quatree','adult','packaged',15000,1,'reviewed','{}',1,${now});
INSERT INTO catalog_product_species(tenant_id,module_id,product_id,species) VALUES(${q(tenant)},'petshop',${q(product)},'dog');`)
async function login(email,password){
 const r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({email,password,rememberMe:false})})
 assert.equal(r.status,200,'sign in');const cookies=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');assert(cookies.includes('better-auth'));return cookies
}
const cookie=await login(process.env.E2E_EMAIL,process.env.E2E_PASSWORD)
const headers={'content-type':'application/json','x-tenant-id':tenant,'x-module-id':'petshop',origin:base,cookie}
async function api(path,method='GET',body,extra={}){const r=await fetch(base+path,{method,headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()}}
const submit=async(message,id)=>{const r=await api('/api/chat/respond','POST',{sessionId:thread,clientMessageId:fixture.runId+'-'+id,message});assert.equal(r.status,202,JSON.stringify(r));return r.body.turn_id}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const status=id=>api(`/api/chat/turns/${id}?sessionId=${thread}`)
async function complete(id){
 for(let i=0;i<90;i++){const r=await status(id);assert.equal(r.status,200,JSON.stringify(r));if(r.body.status==='complete'){assert.notEqual(r.body.result?.status,'handoff',JSON.stringify(r));console.log(JSON.stringify({event:'luna.turn.complete',status:r.body.result.status,usage:r.body.result.usage}));return r.body.result}assert(!['failed','requires_reconciliation'].includes(r.body.status),JSON.stringify(r));await sleep(2000)}throw Error('LUNA_STAGING_TIMEOUT')
}
assert.equal((await api('/api/chat/quality','GET',null,{cookie:''})).status,401)
assert.equal((await api('/api/chat/quality','GET',null,{'x-tenant-id':fixture.isolationTenantId})).status,403)
const otherCookie=await login(process.env.TENANT_B_EMAIL,process.env.TENANT_B_PASSWORD)
assert.equal((await api('/api/chat/respond','POST',{sessionId:thread,clientMessageId:'blocked',message:'Olá'},{cookie:otherCookie,'x-tenant-id':fixture.isolationTenantId})).status,403)
// Staging groups messages like production (LUNA_INBOX_DEBOUNCE_MS=10000); with
// 0 the grouping step is skipped.
const debounceMs=Number(process.env.LUNA_INBOX_DEBOUNCE_MS??10000)
let prepared
if(debounceMs>0){
 const first=await submit('Olá, quero uma Ração A de 15 kg para cachorro adulto.','part1')
 await sleep(3000)
 const second=await submit('Um pacote, vou retirar na loja.','part2')
 await sleep(5000)
 assert.equal((await status(first)).body.status,'queued','no inference before debounce expires')
 prepared=await complete(second)
 assert.equal((await status(first)).body.result.reply,prepared.reply)
 assert.equal(prepared.savedUserMessages.length,2)
}else prepared=await complete(await submit('Olá, quero um pacote da Ração A de 15 kg para cachorro adulto, vou retirar na loja.','part1'))
assert.equal(prepared.status,'awaiting_confirmation')
assert.equal(db(`SELECT count(*) n FROM sales WHERE tenant_id=${q(tenant)}`)[0].n,0)
const confirmed=await complete(await submit('Confirmo esse pedido para retirada.','confirm'))
assert.match(confirmed.reply,/1 a 5|estrelas/i)
assert.deepEqual(db(`SELECT status,total_cents FROM sales WHERE tenant_id=${q(tenant)}`),[{status:'pending',total_cents:9000}])
assert.equal(db(`SELECT count(*) n FROM payments WHERE tenant_id=${q(tenant)}`)[0].n,0)
assert.equal(db(`SELECT reserved_milliunits FROM inventory_balances WHERE tenant_id=${q(tenant)} AND product_id=${q(product)}`)[0].reserved_milliunits,1000)
await complete(await submit('5 estrelas','rating'))
const quality=await api('/api/chat/quality')
assert.equal(quality.status,200);assert.equal(quality.body.items.find(i=>i.id===thread)?.csat_score,5)
const staffCookie=await login(process.env.E2E_COMMON_EMAIL,process.env.E2E_COMMON_PASSWORD)
assert.equal((await api('/api/chat/quality','GET',null,{cookie:staffCookie})).body.canReview,false)
assert.equal((await api(`/api/chat/quality/${thread}/review`,'PATCH',{status:'reviewed',notes:'Bloqueado'},{cookie:staffCookie})).status,403)
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/entrar')
 await page.getByLabel('E-mail',{exact:true}).fill(process.env.E2E_EMAIL)
 await page.getByLabel('Senha',{exact:true}).fill(process.env.E2E_PASSWORD)
 await page.locator('form button[type="submit"]').click()
 await page.waitForURL(u=>!u.pathname.startsWith('/entrar'),{timeout:30000})
 await page.goto(base+'/petshop/chat')
 await page.getByRole('button',{name:'Avaliações',exact:true}).first().click()
 const panel=page.getByRole('region',{name:'Controle de qualidade das avaliações'})
 await panel.getByLabel('Nota 5 de 5').waitFor({timeout:30000})
 await panel.getByLabel('Observação da revisão').fill('Revisão de staging: atendimento validado.')
 await panel.getByRole('button',{name:'Marcar como revisado'}).click()
 await panel.getByText('Revisado',{exact:true}).waitFor()
 assert.deepEqual(errors,[])
}finally{await browser.close()}
const reviewed=(await api('/api/chat/quality')).body.items.find(i=>i.id===thread)
assert.equal(reviewed.quality_review.status,'reviewed');assert.equal(reviewed.csat_score,5)
console.log(JSON.stringify({event:'luna.staging.certified',debounceSeconds:debounceMs/1000,nativeWorkersAI:true,tenantIsolation:true,qualityUI:true,pendingSales:1,payments:0}))
