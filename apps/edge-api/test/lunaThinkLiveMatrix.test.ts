import {env} from 'cloudflare:workers'
import {describe,it,expect} from 'vitest'
import {createLiveHarness,liveService} from './fixtures/luna/liveHarness'
import {pathNames} from './fixtures/luna/thinkPaths'

function futureDay(){const d=new Date();d.setUTCDate(d.getUTCDate()+3);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
const day=futureDay(),at=(hour:number)=>day+'T'+String(hour).padStart(2,'0')+':00:00-03:00'
type Scenario={messages:(string|string[])[];kind:'sale'|'booking'|'withdrawn'|'handoff'|'restock';items?:Record<string,number>;delivery?:boolean;hour?:number;empty?:string;reserved?:boolean;history?:boolean;serviceHistory?:boolean;busy?:boolean;number?:string;pets?:boolean;reference?:string}
const address='Rua Teste, número 48, bairro Centro, Cidade Teste'
function scenario(id:number):Scenario{
 const purchase=(items:Record<string,number>={'racao-a':1},delivery=false)=>({kind:'sale' as const,items,delivery})
 const booking=(hour:number)=>({kind:'booking' as const,hour})
 const bath='Quero só banho para a Mel, minha cachorrinha de 8 kg. Quanto custa?'
 const when=(hour:number)=>day+' às '+hour+'h'
 const cases:Record<number,Scenario>={
  1:{messages:['Oi, tem ração para cachorro adulto, saco de 15 kg até 130 reais?',`Quero uma Ração A de 15 kg. Entrega em ${address}. Prepare o resumo.`],...purchase({'racao-a':1},true)},
  2:{messages:['Tem areia comum para gato que não faça sujeira?','Aceito uma Areia comum 4 kg para retirar, mesmo sem garantia sobre sujeira. Prepare o resumo.'],...purchase({areia:1})},
  3:{messages:[bath,`Pode consultar ${when(14)}? Eu levo e busco a Mel. Prepare o resumo só do banho.`],...booking(14)},
  4:{messages:['Queria petiscos molinhos para cachorro.','Mesmo sem confirmação de textura, quero dois pacotes do Bifinho carne 60 g para retirar. Prepare o resumo.'],...purchase({petisco:2})},
  5:{messages:['Tem cama para cachorro? Ele pesa 12 kg. Vocês têm as medidas?','Quero uma Cama G para retirar, mesmo sem confirmação das medidas. Prepare o resumo.'],...purchase({'cama-g':1})},
  6:{messages:[`Bom dia, quero uma Ração A de 15 kg para cachorro adulto, entrega em ${address}. Prepare o resumo.`],...purchase({'racao-a':1},true)},
  7:{messages:['Quero oito sachês para minha gata, vou retirar na loja. Prepare o resumo.'],...purchase({sache:8})},
  8:{messages:[bath,`Quero ${when(9)}. Eu levo e busco a Mel. Confira a vaga e prepare o resumo.`],...booking(9)},
  9:{messages:['Quero uma Ração A de 15 kg e um Tapete 28 unidades para retirar. Prepare um resumo com os dois itens.'],...purchase({'racao-a':1,tapete:1})},
 10:{messages:['Quero uma Coleira azul para retirar. Minha irmã Ana vai buscar, anote isso e prepare o resumo.'],...purchase({'coleira-azul':1}),reference:'Ana'},
 11:{messages:['Tem Ração A de 15 kg para cachorro adulto?','Aceito uma Ração B de 15 kg para retirar. Prepare o resumo.'],...purchase({'racao-b':1}),empty:'racao-a'},
 12:{messages:['A Areia comum 4 kg voltou ao estoque?','Pode me avisar aqui quando a Areia comum 4 kg chegar.'],kind:'restock',empty:'areia'},
 13:{messages:[bath,`Quero ${when(14)}. Eu levo a Mel.`,`Se às 14h está ocupado, consulte ${when(15)} e prepare o resumo.`],...booking(15),busy:true},
 14:{messages:['Quero coleira rosa choque, só essa cor.','Então deixa pra lá, não vou querer.'],kind:'withdrawn'},
 15:{messages:['Tem um pacote de Ração A de 15 kg?','Aceito uma Ração B de 15 kg para retirar. Prepare o resumo.'],...purchase({'racao-b':1}),empty:'racao-a',reserved:true},
 16:{messages:['Quero repetir a ração da minha última compra.',`Uma unidade, entrega em ${address}. Prepare o resumo com o preço de hoje.`],...purchase({'racao-a':1},true),history:true},
 17:{messages:['Quero o banho de sempre da Mel, minha cachorrinha de 8 kg.',`Pode consultar ${when(10)}? Eu levo e busco a Mel. Prepare o resumo.`],...booking(10),serviceHistory:true},
 18:{messages:['Tem a ração que comprei da última vez? Quanto está hoje?','Quero uma unidade para retirar. Prepare o resumo.'],...purchase(),history:true},
 19:{messages:['Quero repetir o remédio de sempre. Você tem meu histórico?','Qual dose devo dar? Quero falar com uma pessoa.'],kind:'handoff'},
 20:{messages:['Quero repetir a última ração.','Agora quero duas unidades, para retirar. Prepare o resumo.'],...purchase({'racao-a':2}),history:true},
 21:{messages:['Quero uma Ração A de 15 kg para retirar. Prepare o resumo.','Sim, mas troque por uma Ração B de 15 kg. Prepare outro resumo antes de fechar.'],...purchase({'racao-b':1})},
 22:{messages:[`Quero uma Ração A de 15 kg, entrega em ${address}. Prepare o resumo.`,'Melhor retirar na loja. Atualize o resumo sem entrega.'],...purchase()},
 23:{messages:[bath,`Quero ${when(9)}, eu levo e busco a Mel. Prepare o resumo.`,`Sim, mas mude para ${when(14)}. Prepare outro resumo antes de confirmar.`],...booking(14)},
 24:{messages:['Quero uma Ração A de 15 kg e dois sachês para retirar. Prepare o resumo.','Retire os sachês do carrinho. Prepare o resumo só com a ração.'],...purchase()},
 25:{messages:[`Quero uma Ração A de 15 kg, entrega em ${address}. Prepare o resumo.`,'Frete caro, não quero mais. Desisti do pedido.'],kind:'withdrawn'},
 26:{messages:[['Ração A de 15 kg','Quero uma unidade.','Vou retirar na loja, prepare o resumo.']],...purchase()},
 27:{messages:[[`Quero uma Ração A de 15 kg, entrega em ${address}.`,'Corrigindo, o número é 84. Prepare o resumo com esse número.']],...purchase({'racao-a':1},true),number:'84'},
 28:{messages:[['Uma Ração A de 15 kg para a Mel','Oito sachês para minha gata Luna','Vou retirar, prepare o resumo com os dois pets e itens.']],...purchase({'racao-a':1,sache:8}),pets:true},
 29:{messages:[['Banho e tosa para a Mel, minha cachorrinha de 8 kg.','Corrigindo: só banho, sem tosa.',`Consulte ${when(9)}, eu levo e busco a Mel. Prepare o resumo só do banho.`]],...booking(9)},
 30:{messages:['Quero duas Ração A de 15 kg para retirar. Prepare o resumo.',['Sim.','Espera, quero só uma. Atualize o resumo antes de fechar.']],...purchase()},
 }
 return cases[id]
}

describe.skipIf(!('LIVE_MODEL' in env))('30 caminhos com GLM real, dados sintéticos e domínio local',()=>{
 const range=env as unknown as {LIVE_FROM?:number;LIVE_TO?:number;LIVE_IDS?:string}
 for(let id=Number(range.LIVE_FROM??1);id<=Number(range.LIVE_TO??30);id++)it(String(id).padStart(2,'0')+' '+pathNames[id-1],async test=>{
  if(range.LIVE_IDS&&!range.LIVE_IDS.split(',').map(Number).includes(id)){test.skip();return}
  const control=await(await liveService.fetch('https://live-model.local/control')).json() as {stop:boolean}
  if(control.stop){test.skip();return}
  const h=await createLiveHarness(id),s=scenario(id)
  try{
   if(s.empty)await h.db.prepare('UPDATE inventory_balances SET on_hand_milliunits=?,reserved_milliunits=? WHERE tenant_id=? AND product_id=?').bind(s.reserved?1000:0,s.reserved?1000:0,h.tenant,s.empty).run()
   if(s.history){
    await h.db.batch([
     h.db.prepare("INSERT INTO sales(tenant_id,module_id,id,operation_key,client_id,source,fulfillment_type,subtotal_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','history','history','cliente-maria','manual','counter',8000,8000,'completed',?,?)").bind(h.tenant,Date.now()-86400000,Date.now()-86400000),
     h.db.prepare("INSERT INTO sale_items(tenant_id,module_id,sale_id,position,item_type,product_id,item_name,quantity_milliunits,unit_price_cents,subtotal_cents) VALUES(?,'petshop','history',0,'product','racao-a','Ração A',1000,8000,8000)").bind(h.tenant),
    ])
   }
   const seedAppointment=async(key:string,time:number,status:string)=>h.db.prepare("INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,status,source,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'cliente-maria','mel',?,60,?,'manual',?,?)").bind(h.tenant,key,time,status,Date.now(),Date.now()).run()
   if(s.serviceHistory){await seedAppointment('previous-bath',Date.now()-86400000,'completed');await h.db.prepare("INSERT INTO appointment_services(tenant_id,module_id,appointment_id,position,service_id,service_code,service_name,service_group,unit_price_cents,duration_min) VALUES(?,'petshop','previous-bath',0,'banho','banho','banho','banho_tosa',5500,60)").bind(h.tenant).run()}
   if(s.busy){await h.db.prepare("UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.petbot_booking_capacity',1) WHERE tenant_id=?").bind(h.tenant).run();await seedAppointment('busy',Date.parse(at(14)),'scheduled')}
   let last:{status:string;reply:string}|undefined
   const sales=async()=> (await h.saleRows()).results.filter(r=>r.id!=='history')
   const bookings=async()=> (await h.db.prepare("SELECT id,status,scheduled_at_ms FROM appointments WHERE tenant_id=? AND id NOT IN ('busy','previous-bath')").bind(h.tenant).all<Record<string,any>>()).results
   for(const message of s.messages){
    last=await h.turn(message)
    if(s.kind!=='handoff')expect(last.status,'Unexpected handoff: '+last.reply).not.toBe('handoff')
    expect((await sales()).length,'Sale before explicit confirmation').toBe(0)
    expect((await bookings()).length,'Booking before explicit confirmation').toBe(0)
   }
   if(s.kind==='sale'||s.kind==='booking'){
    expect(last?.status,'No final proposal: '+last?.reply).toBe('awaiting_confirmation')
    const confirmed=await h.turn('Confirmo.')
    expect(confirmed.status,'Commit failed: '+confirmed.reply).toBe('replied')
    await h.turn('5 estrelas')
   }
   const records={sales:await sales(),appointments:await bookings(),thread:await h.db.prepare('SELECT status,csat_score,context_json FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first<Record<string,any>>()}
   expect(await h.db.prepare('SELECT COUNT(*) n FROM payments WHERE tenant_id=?').bind(h.tenant).first()).toEqual({n:0})
   if(s.kind==='sale'){
    expect(records.sales).toHaveLength(1);expect(records.appointments).toHaveLength(0)
    const sale=records.sales[0];expect(sale.status).toBe('pending');expect(sale.fulfillment_type).toBe(s.delivery?'delivery':'counter')
    const items=(await h.db.prepare('SELECT product_id,quantity_milliunits FROM sale_items WHERE tenant_id=? AND sale_id=? ORDER BY product_id').bind(h.tenant,sale.id).all()).results
    const expected=Object.entries(s.items!).map(([product_id,n])=>({product_id,quantity_milliunits:n*1000})).sort((a,b)=>a.product_id.localeCompare(b.product_id))
    expect(items).toEqual(expected)
    const prices:Record<string,number>={'racao-a':9000,'racao-b':11000,sache:800,areia:2000,petisco:2000,'cama-g':2000,'coleira-azul':2000,tapete:2000}
    expect(sale.total_cents).toBe(Object.entries(s.items!).reduce((n,[k,q])=>n+prices[k]*q,0)+(s.delivery?1500:0))
    const reservations=(await h.db.prepare('SELECT product_id,quantity_milliunits FROM pending_order_stock_reservations WHERE tenant_id=? AND sale_id=? ORDER BY product_id').bind(h.tenant,sale.id).all()).results;expect(reservations).toEqual(expected)
    if(s.number)expect(await h.db.prepare('SELECT number FROM sale_delivery_addresses WHERE tenant_id=? AND sale_id=?').bind(h.tenant,sale.id).first()).toEqual({number:s.number})
    if(s.reference){const row=await h.db.prepare('SELECT notes FROM sales WHERE tenant_id=? AND id=?').bind(h.tenant,sale.id).first<{notes:string}>();expect(row?.notes).toContain(s.reference)}
    if(s.pets){const row=await h.db.prepare("SELECT payload_json FROM luna_proposals WHERE tenant_id=? AND status='completed'").bind(h.tenant).first<{payload_json:string}>();const items=JSON.parse(row!.payload_json).items;expect(items.find((i:any)=>i.product_id==='racao-a').pet_id).toBe('mel');expect(items.find((i:any)=>i.product_id==='sache').pet_id).toBe('luna')}
   }else if(s.kind==='booking'){
    expect(records.sales).toHaveLength(0);expect(records.appointments).toHaveLength(1);expect(records.appointments[0]).toMatchObject({status:'scheduled',scheduled_at_ms:Date.parse(at(s.hour!))})
    expect((await h.db.prepare('SELECT service_id FROM appointment_services WHERE tenant_id=? AND appointment_id=?').bind(h.tenant,records.appointments[0].id).all()).results).toEqual([{service_id:'banho'}])
   }else{
    expect(records.sales).toHaveLength(0);expect(records.appointments).toHaveLength(0)
    if(s.kind==='handoff')expect(records.thread?.status).toBe('handoff')
    if(s.kind==='withdrawn')expect(records.thread?.status).toBe('closed')
    if(s.kind==='restock')expect(JSON.parse(records.thread!.context_json).think.restock_product).toBe('areia')
   }
   if(s.kind==='sale'||s.kind==='booking'){expect(records.thread).toMatchObject({status:'closed',csat_score:5})}
   await h.evidence('passed',{name:pathNames[id-1],records})
  }catch(error){await h.evidence('failed',{name:pathNames[id-1],error:String(error)});throw error}finally{h.close()}
 })
})
