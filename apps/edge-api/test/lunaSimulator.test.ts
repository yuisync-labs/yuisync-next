import {env} from 'cloudflare:workers'
import {describe,it} from 'vitest'
import {createLiveHarness,liveService} from './fixtures/luna/liveHarness'
import {applyQuatroPatasStore} from './fixtures/luna/simulatorStore'
import {simulatorScenarios,type SimScenario} from './fixtures/luna/simulatorScenarios'
import store from './fixtures/luna/quatropatas-store.json'
// Simulated customers against the real Luna: a model plays the customer from a
// random scenario, Luna answers on local Think/D1 fixtures with the QuatroPatas
// catalogue, and the run is judged on the database plus one reading of the chat.
// Admitted only by vitest.simulator.config.ts; standard CI skips it.
const config=env as unknown as {SIM_COUNT?:string;SIM_SEED?:string;SIM_CUSTOMER_MODEL?:string}
const count=Number(config.SIM_COUNT??0),seed=Number(config.SIM_SEED??1),customerModel=config.SIM_CUSTOMER_MODEL??'gpt-4.1-mini'
const MAX_TURNS=10
type Line={from:'cliente'|'luna';text:string;status?:string}

async function chat(messages:{role:string;content:string}[],temperature:number){
 const r=await liveService.fetch('https://live-model.local/openai/v1/chat/completions',{method:'POST',body:JSON.stringify({model:customerModel,messages,temperature,max_tokens:300,response_format:{type:'json_object'}})})
 if(!r.ok)throw Error('SIM_MODEL_'+r.status+':'+(await r.text()).slice(0,200))
 const body=await r.json() as {choices:{message:{content:string}}[]}
 return JSON.parse(body.choices[0].message.content) as Record<string,unknown>
}
const transcript=(lines:Line[])=>lines.map(l=>(l.from==='cliente'?'Cliente: ':'Atendente: ')+l.text).join('\n')

async function customerSays(s:SimScenario,lines:Line[]){
 const system=`Você faz o papel de um CLIENTE de pet shop conversando pelo WhatsApp com a atendente virtual da loja. Responda só como o cliente, em português do Brasil.
Seu objetivo: ${s.persona}
O que você sabe (use só quando fizer sentido ou quando perguntarem): ${s.facts}
Jeito de escrever: ${s.style}.
Desvio de roteiro: ${s.detour}.
Regras: uma mensagem curta por vez, como no WhatsApp. Nunca invente dados além dos acima. Responda ao que a atendente perguntou. Se ela pedir uma nota de 1 a 5, responda 5. Quando o objetivo estiver cumprido, ou se a atendente disser que passou para alguém da loja, ou se ficar claro que não vai dar, encerre.
Responda em JSON: {"mensagem": "texto do cliente", "fim": false}. Use "fim": true sem mensagem quando a conversa já terminou para você.`
 const out=await chat([{role:'system',content:system},{role:'user',content:lines.length?'Conversa até agora:\n'+transcript(lines)+'\n\nSua próxima mensagem:':'Comece a conversa.'}],0.9)
 return {message:String(out.mensagem??'').trim(),done:out.fim===true}
}

async function judge(s:SimScenario,lines:Line[]){
 const prices=store.services.filter(v=>v.group_type==='banho_tosa').map(v=>`${v.name}: R$ ${(v.price_cents/100).toFixed(2)}`).join('; ')
 const out=await chat([{role:'system',content:`Você avalia uma conversa entre um cliente e a atendente virtual de um pet shop. Seja rigoroso e objetivo. Preços do cadastro (banho e tosa): ${prices}. MotoDog: buscar e levar R$ 20, só buscar ou só levar R$ 10, só para pets até 10 kg. Entrega R$ 10 em Muriaé.
Responda em JSON: {"pergunta_repetida": bool (a atendente pediu de novo um dado que o cliente já tinha dado), "nao_entendeu": bool (a atendente não entendeu o que o cliente queria ou seguiu no caminho errado), "informacao_errada": bool (preço, regra ou dado errado dito pela atendente), "comentario": "uma frase curta"}`},{role:'user',content:`Objetivo do cliente: ${s.persona}\n\n${transcript(lines)}`}],0)
 return {repeated:out.pergunta_repetida===true,misunderstood:out.nao_entendeu===true,wrongInfo:out.informacao_errada===true,comment:String(out.comentario??'')}
}

// Words that only the system should see.
const INTERNAL=/\b[a-z]+_id\b|[0-9a-f]{8}-[0-9a-f]{4}|\brascunho|\bc[oó]digo (?:corret|errad)|problema t[eé]cnico|\bfiltro (?:de|para|por)\b|\bferramenta|\bjson\b|\bschema\b/i

describe.skipIf(!liveService||!count)('Simulated customers',()=>{
 for(const s of simulatorScenarios(count,seed))it(s.id+' '+s.goal,async test=>{
  const control=await(await liveService.fetch('https://live-model.local/control')).json() as {stop:boolean}
  if(control.stop){test.skip();return}
  const h=await createLiveHarness(9000+s.index)
  const lines:Line[]=[],problems:string[]=[],grave:string[]=[]
  let handoff=false,error:string|null=null,judged:Awaited<ReturnType<typeof judge>>|null=null
  try{
   await applyQuatroPatasStore(h,s)
   for(let turn=0;turn<MAX_TURNS;turn++){
    const next=await customerSays(s,lines)
    if(next.done||!next.message)break
    lines.push({from:'cliente',text:next.message})
    const r=await h.turn(next.message)
    lines.push({from:'luna',text:String(r.reply??''),status:String(r.status??'')})
    if(INTERNAL.test(String(r.reply??'')))grave.push('texto interno: '+String(r.reply).slice(0,120))
    if(r.status==='handoff'){handoff=true;break}
   }
  }catch(e){error=String(e).slice(0,300)}
  const e=s.expect
  const appointments=(await h.db.prepare("SELECT a.id,a.scheduled_at_ms,(SELECT group_concat(service_id) FROM appointment_services x WHERE x.tenant_id=a.tenant_id AND x.appointment_id=a.id) services,(SELECT option_id FROM appointment_transport t WHERE t.tenant_id=a.tenant_id AND t.appointment_id=a.id) transport FROM appointments a WHERE a.tenant_id=? AND a.status<>'cancelled'").bind(h.tenant).all<{id:string;scheduled_at_ms:number;services:string|null;transport:string|null}>()).results
  const sales=(await h.db.prepare("SELECT id,total_cents,fulfillment_type FROM sales WHERE tenant_id=?").bind(h.tenant).all<{id:string;total_cents:number;fulfillment_type:string}>()).results
  // Grave: a price that is not the catalogue price.
  const wrongService=await h.db.prepare("SELECT x.service_id,x.unit_price_cents,s.default_price_cents FROM appointment_services x JOIN services s ON s.tenant_id=x.tenant_id AND s.id=x.service_id WHERE x.tenant_id=? AND x.unit_price_cents<>s.default_price_cents AND x.benefit_used=0 LIMIT 1").bind(h.tenant).first()
  if(wrongService)grave.push('preço de serviço diferente do cadastro: '+JSON.stringify(wrongService))
  const wrongProduct=await h.db.prepare("SELECT i.product_id,i.unit_price_cents,p.price_cents FROM sale_items i JOIN catalog_products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id WHERE i.tenant_id=? AND i.unit_price_cents<>p.price_cents LIMIT 1").bind(h.tenant).first()
  if(wrongProduct)grave.push('preço de produto diferente do cadastro: '+JSON.stringify(wrongProduct))
  if(error)problems.push('erro na execução: '+error)
  if(e.appointments!==undefined&&appointments.length!==e.appointments)problems.push(`agendamentos: esperado ${e.appointments}, ficou ${appointments.length}`)
  const first=appointments[0]
  if(first&&e.service&&first.services!==e.service)problems.push(`serviço: esperado ${e.service}, ficou ${first.services}`)
  if(first&&e.serviceOneOf&&!e.serviceOneOf.includes(String(first.services)))problems.push(`serviço: esperado um de ${e.serviceOneOf.join('/')}, ficou ${first.services}`)
  if(e.serviceOneOf&&!first&&e.appointments===undefined)problems.push('nenhum agendamento')
  if(first&&e.transport!==undefined&&(first.transport??null)!==e.transport)problems.push(`transporte: esperado ${e.transport??'nenhum'}, ficou ${first.transport??'nenhum'}`)
  if(first&&e.hour!==undefined&&new Date(first.scheduled_at_ms-3*3600000).getUTCHours()!==e.hour)problems.push(`horário: esperado ${e.hour}h, ficou ${new Date(first.scheduled_at_ms-3*3600000).getUTCHours()}h`)
  if(e.sales!==undefined&&sales.length!==e.sales)problems.push(`pedidos: esperado ${e.sales}, ficou ${sales.length}`)
  if(sales[0]&&e.saleTotalCents!==undefined&&sales[0].total_cents!==e.saleTotalCents)problems.push(`total do pedido: esperado ${e.saleTotalCents}, ficou ${sales[0].total_cents}`)
  if(sales[0]&&e.fulfillment&&sales[0].fulfillment_type!==e.fulfillment)problems.push(`modalidade: esperado ${e.fulfillment}, ficou ${sales[0].fulfillment_type}`)
  if(e.handoff===true&&!handoff)problems.push('não passou para a loja')
  if(e.handoff!==true&&handoff&&s.goal!=='sintoma de saúde')problems.push('passou para a loja sem motivo')
  if(e.newClient&&!await h.db.prepare("SELECT 1 x FROM clients WHERE tenant_id=? AND name LIKE 'Joana%'").bind(h.tenant).first())problems.push('cliente novo não foi cadastrado')
  for(const p of e.neverProducts??[])if(await h.db.prepare("SELECT 1 x FROM sale_items WHERE tenant_id=? AND product_id=?").bind(h.tenant,p).first())grave.push('vendeu produto sem estoque: '+p)
  for(const v of e.neverServices??[])if(await h.db.prepare("SELECT 1 x FROM appointment_services WHERE tenant_id=? AND service_id=?").bind(h.tenant,v).first())problems.push('agendou serviço escondido: '+v)
  if(e.replyMatches&&!lines.some(l=>l.from==='luna'&&l.text.includes(e.replyMatches!)))problems.push('não informou o preço esperado (R$ '+e.replyMatches+')')
  if(lines.length){try{judged=await judge(s,lines)}catch(err){problems.push('avaliação não rodou: '+String(err).slice(0,120))}}
  if(judged?.misunderstood)problems.push('não entendeu o cliente: '+judged.comment)
  if(judged?.wrongInfo)problems.push('informação errada: '+judged.comment)
  const status=grave.length?'grave':problems.length?'failed':'passed'
  await liveService.fetch('https://live-model.local/evidence',{method:'POST',body:JSON.stringify({id:s.index,kind:'simulator',status,scenario:{id:s.id,goal:s.goal,style:s.style,detour:s.detour,persona:s.persona},lines,problems,grave,repeated:judged?.repeated??null,judge:judged,turns:h.turns.map(t=>({trace:t.trace,handoffReason:t.handoffReason,usage:t.result?.result?.usage}))})})
 },900000)
})
