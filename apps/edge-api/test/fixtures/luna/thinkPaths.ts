import {expect} from 'vitest'
import {command as c,createThinkHarness} from './thinkHarness'

export const pathNames=['Ração e orçamento','Areia e desempenho desconhecido','Banho sem horário','Petisco e quantidade','Cama sem medidas','Ração direta com entrega','Oito sachês','Banho em horário específico','Pedido misto','Retirada por terceiro','Marca sem saldo e alternativa','Consentimento de reposição','Vaga ocupada e alternativa','Cor indisponível e desistência','Última unidade reservada','Compra de sempre e endereço','Banho habitual','Recompra com preço novo','Histórico ausente e risco clínico','Recompra alterando quantidade','Troca de produto antes de confirmar','Entrega muda para retirada','Correção de horário','Remove item','Desiste após frete','Mensagens fragmentadas','Correção de endereço fragmentada','Itens para dois pets','Banho sem tosa','Correção de quantidade antes de fechar']
export async function runThinkPath(id:number){
 const h=await createThinkHarness(id),at='2026-10-07T12:00:00Z',later='2026-10-07T17:00:00Z'
 const address={street:'Rua Teste',number:'48',city:'Cidade Teste',neighborhood:'Centro'}
 const field=(field:string,value:string)=>({action:'set_field',field,value})
 const delivery=[{action:'set_fulfillment',value:'delivery'},field('address',JSON.stringify(address))]
 const openCart=c('open_tools',{capability:'cart'}),openAgenda=c('open_tools',{capability:'agenda'})
 async function finish(kind='product_order_create',message:string|string[]='Confirmo.'){
  const p=await h.proposal(kind);await h.run(message,[c('commit_confirmed_proposal',p)])
  const thread=await h.db.prepare('SELECT status,csat_score FROM chat_threads WHERE tenant_id=? AND id=?').bind(h.tenant,h.ctx.conversationId).first()
  expect(thread).toMatchObject({status:'closed',csat_score:null})
  await h.run('5 estrelas',[c('record_rating',{score:5})])
  expect(await h.db.prepare('SELECT csat_score FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first()).toEqual({csat_score:5})
 }
 async function book(atValue=at,prepare=true){return h.update([h.add('banho'),field('pet_id','mel'),field('scheduled_at',atValue)],prepare,'banho-mel','booking')}
 async function assertItems(expected:{product_id:string;quantity_milliunits:number}[]){const rows=await h.db.prepare('SELECT product_id,quantity_milliunits FROM sale_items WHERE tenant_id=? ORDER BY product_id').bind(h.tenant).all();expect(rows.results).toEqual([...expected].sort((a,b)=>a.product_id.localeCompare(b.product_id)))}
 try{
  switch(id){
   case 1:
    await h.run('oi, tem ração para cachorro?',[c('search_products',{filters:{productType:'feed',species:'dog'}}),'É adulto ou filhote?'])
    await h.run('adulto, 15 kg e até 130 reais',[c('search_products',{filters:{lifeStage:'adult',packageWeightGrams:15000,maxPriceCents:13000}}),'Tenho duas opções. Qual prefere?'])
    await h.run('Ração A, uma, entrega na Rua Teste 48, Centro, Cidade Teste',[openCart,h.update([h.add(),...delivery])]);await finish();break
   case 2:
    await h.run('tem areia comum? Não quero sujeira',[c('search_products',{filters:{catalogCategory:'hygiene',subtype:'litter',productName:'areia'}}),'Tenho areia comum. O cadastro não informa desempenho; você quer esse produto?'])
    await h.run('quero uma comum para retirada',[openCart,h.update([h.add('areia'),h.pickup])]);await finish();await assertItems([{product_id:'areia',quantity_milliunits:1000}]);break
   case 3:
    await h.run('tem banho para Mel?',[openAgenda,c('search_services',{query:'banho',pet_id:'mel'}),'Qual dia é melhor?'])
    await h.run('amanhã à tarde',[c('get_available_slots',{service_ids:['banho'],starts_at:'2026-10-07T13:00:00-03:00',ends_at:'2026-10-07T18:00:00-03:00'}),'Há opções às 13h e 14h.'])
    await h.run('14h para Mel',[await book(later)]);await finish('appointment_create');break
   case 4:
    await h.run('queria petiscos molinhos, cachorro',[c('search_products',{filters:{productType:'treat',productName:'bifinho'}}),'Tenho bifinho de carne. Textura não está cadastrada.'])
    await h.run('dois bifinhos carne para retirar',[openCart,h.update([h.add('petisco',2),h.pickup])]);await finish();await assertItems([{product_id:'petisco',quantity_milliunits:2000}]);break
   case 5:
    await h.run('tem cama tamanho G?',[c('search_products',{filters:{catalogCategory:'accessory',subtype:'bed'}}),'Tenho Cama G; o cadastro não informa medidas.'])
    await h.run('pode ser a Cama G, uma, retirada',[openCart,h.update([h.add('cama-g'),h.pickup])]);await finish();break
   case 6:
    await h.run('Ração A, um pacote, entrega Rua Teste 48, Centro, Cidade Teste',[openCart,h.update([h.add(),...delivery])]);await finish('product_order_create','confirmo, pix');expect((await h.saleRows()).results).toMatchObject([{status:'pending',fulfillment_type:'delivery',total_cents:10500}]);break
   case 7:
    await h.run('separa 8 sachês para retirada',[openCart,h.update([h.add('sache',8),h.pickup])]);await finish();await assertItems([{product_id:'sache',quantity_milliunits:8000}]);break
   case 8:
    await h.run('banho da Mel amanhã às 9',[openAgenda,c('get_available_slots',{service_ids:['banho'],starts_at:'2026-10-07T09:00:00-03:00',ends_at:'2026-10-07T12:00:00-03:00'}),await book()]);await finish('appointment_create');break
   case 9:
    await h.run('uma Ração A e um tapete para retirar',[openCart,h.update([h.add(),h.add('tapete'),h.pickup])]);await finish();await assertItems([{product_id:'racao-a',quantity_milliunits:1000},{product_id:'tapete',quantity_milliunits:1000}]);break
   case 10:
    await h.run('quero uma coleira azul, minha irmã retira',[openCart,h.update([h.add('coleira-azul'),h.pickup,field('reference','Minha irmã Ana retira.')])]);await finish();expect((await h.state()).operations.cart.fields.reference).toContain('Ana');break
   case 11:
    await h.db.prepare("UPDATE inventory_balances SET on_hand_milliunits=0 WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).run()
    await h.run('tem Ração A para cachorro?',[c('search_products',{filters:{productName:'Ração A',species:'dog'}}),'O saldo da Ração A está zerado. Quer outra opção?'])
    await h.run('aceito Ração B, uma, retirada',[openCart,h.update([h.add('racao-b'),h.pickup])]);await finish();await assertItems([{product_id:'racao-b',quantity_milliunits:1000}]);break
   case 12:
    await h.db.prepare("UPDATE inventory_balances SET on_hand_milliunits=0 WHERE tenant_id=? AND product_id='areia'").bind(h.tenant).run()
    await h.run('a areia comum voltou?',[c('search_products',{filters:{catalogCategory:'hygiene',productName:'areia'}}),'O saldo está zerado. Deseja aviso neste canal?'])
    await h.run('pode me avisar quando chegar',[c('register_restock_interest',{product_id:'areia',consent:true}),'Registrei seu interesse para aviso neste canal.'])
    expect(await h.db.prepare("SELECT json_extract(context_json,'$.think.restock_product') product_id FROM chat_threads WHERE tenant_id=?").bind(h.tenant).first()).toEqual({product_id:'areia'});break
   case 13:
    await h.db.prepare("UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.petbot_booking_capacity',1) WHERE tenant_id=?").bind(h.tenant).run()
    await h.db.prepare("INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,status,source,created_at_ms,updated_at_ms) VALUES(?,'petshop','busy','cliente-maria','mel',?,60,'scheduled','manual',?,?)").bind(h.tenant,Date.parse(at),h.start,h.start).run()
    const slots=await h.run('banho amanhã às 9 para Mel',[openAgenda,c('get_available_slots',{service_ids:['banho'],starts_at:at,ends_at:later}),'Às 9h já está ocupado. Podemos ver outro horário?'])
    expect(JSON.stringify(slots.tools)).not.toContain('"slots":["'+at+'"')
    await h.run('pode ser às 14h',[await book(later)]);await finish('appointment_create');break
   case 14:
    await h.run('coleira rosa, só essa cor',[c('search_products',{filters:{catalogCategory:'accessory',subtype:'collar',color:'rosa'}}),'Não encontrei essa cor no catálogo.'])
    await h.run('então deixa pra lá',[c('close_conversation',{outcome:'withdrawn'})]);break
   case 15:
    await h.db.prepare("UPDATE inventory_balances SET on_hand_milliunits=1000,reserved_milliunits=1000 WHERE tenant_id=? AND product_id='racao-a'").bind(h.tenant).run()
    await h.run('tem Ração A?',[c('search_products',{filters:{productName:'Ração A'}}),'A última unidade já está reservada. Quer alternativa?'])
    await h.run('Ração B, uma, retirada',[openCart,h.update([h.add('racao-b'),h.pickup])]);await finish();break
   case 16:case 18:case 20:
    await h.db.prepare("INSERT INTO sales(tenant_id,module_id,id,operation_key,client_id,source,fulfillment_type,subtotal_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','history','history','cliente-maria','manual','counter',8000,8000,'completed',?,?)").bind(h.tenant,h.start-86400000,h.start).run()
    await h.db.prepare("INSERT INTO sale_items(tenant_id,module_id,sale_id,position,item_type,product_id,item_name,quantity_milliunits,unit_price_cents,subtotal_cents) VALUES(?,'petshop','history',0,'product','racao-a','Ração A',1000,8000,8000)").bind(h.tenant).run()
    await h.run('a ração de sempre',[c('get_customer_history',{}),'Seu último pedido tinha Ração A; vou usar preço atual na proposta.'])
    await h.run(id===20?'agora duas para retirar':id===16?'uma, entrega Rua Teste 48, Centro, Cidade Teste':'uma para retirar, pode preparar',[openCart,h.update([h.add('racao-a',id===20?2:1),...(id===16?delivery:[h.pickup])])]);await finish()
    const recent=(await h.saleRows()).results.filter(r=>r.id!=='history');expect(recent).toMatchObject([{status:'pending',total_cents:id===20?18000:id===16?10500:9000}]);break
   case 17:
    await h.db.prepare("INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,status,source,created_at_ms,updated_at_ms) VALUES(?,'petshop','previous-bath','cliente-maria','mel',?,60,'completed','manual',?,?)").bind(h.tenant,h.start-86400000,h.start,h.start).run()
    await h.run('banho de sempre da Mel, mas amanhã',[c('get_customer_history',{}),'Vamos consultar o catálogo e a vaga atual.'])
    await h.run('às 14h',[openAgenda,await book(later)]);await finish('appointment_create');break
   case 19:
    await h.run('quero repetir o remédio de sempre',[c('get_customer_history',{}),'Não encontrei uma compra anterior desse medicamento.'])
    await h.run('qual dose? quero uma pessoa',[c('handoff_to_human',{reason:'Histórico ausente, solicitação clínica e pedido de humano.'})]);expect(await h.db.prepare('SELECT status FROM chat_threads WHERE tenant_id=?').bind(h.tenant).first()).toEqual({status:'handoff'});break
   case 21:
    await h.run('uma Ração A para retirar',[openCart,h.update([h.add(),h.pickup])]);const old=await h.proposal()
    await h.run('sim, mas troca para Ração B',[h.update([{action:'replace_item',item_id:'racao-a',replacement_id:'racao-b',quantity:1}])]);expect(await h.db.prepare('SELECT status FROM luna_proposals WHERE tenant_id=? AND id=?').bind(h.tenant,old.proposal_id).first()).toEqual({status:'invalidated'});await finish();await assertItems([{product_id:'racao-b',quantity_milliunits:1000}]);break
   case 22:
    await h.run('uma Ração A entrega Rua Teste 48, Centro, Cidade Teste',[openCart,h.update([h.add(),...delivery])])
    await h.run('melhor retirada',[h.update([h.pickup])]);await finish();expect((await h.saleRows()).results).toMatchObject([{fulfillment_type:'counter',total_cents:9000}]);expect(await h.db.prepare('SELECT COUNT(*) count FROM sale_delivery_addresses WHERE tenant_id=?').bind(h.tenant).first()).toEqual({count:0});break
   case 23:
    await h.run('banho Mel amanhã às 9',[openAgenda,await book()]);await h.run('sim, mas troca para 14h',[h.update([field('scheduled_at',later)],true,'banho-mel','booking')]);await finish('appointment_create');expect((await h.db.prepare('SELECT scheduled_at_ms FROM appointments WHERE tenant_id=?').bind(h.tenant).all()).results).toEqual([{scheduled_at_ms:Date.parse(later)}]);break
   case 24:
    await h.run('uma Ração A e 2 sachês, retirar',[openCart,h.update([h.add(),h.add('sache',2),h.pickup])]);await h.run('tira os sachês',[h.update([{action:'remove_item',item_id:'sache'}])]);await finish();await assertItems([{product_id:'racao-a',quantity_milliunits:1000}]);break
   case 25:
    await h.run('uma Ração A entrega Rua Teste 48, Centro, Cidade Teste',[openCart,h.update([h.add(),...delivery])]);await h.run('frete caro, não quero mais',[c('close_conversation',{outcome:'withdrawn'})]);expect((await h.saleRows()).results).toEqual([]);expect((await h.state()).operations.cart.status).toBe('cancelled');break
   case 26:
    await h.run(['Ração A','um pacote','vou retirar'],[openCart,h.update([h.add(),h.pickup])]);await finish('product_order_create',['sim','pix']);await assertItems([{product_id:'racao-a',quantity_milliunits:1000}]);break
   case 27:
    const changed={...address,number:'84'}
    await h.run(['uma Ração A, entrega Rua Teste 48, Centro, Cidade Teste','corrigindo, número 84'],[openCart,h.update([h.add(),{action:'set_fulfillment',value:'delivery'},field('address',JSON.stringify(changed))])]);await finish();expect(await h.db.prepare('SELECT number FROM sale_delivery_addresses WHERE tenant_id=?').bind(h.tenant).first()).toEqual({number:'84'});break
   case 28:
    await h.run(['Ração A para Mel','8 sachês para a gata Luna','retirar'],[openCart,h.update([{...h.add(),pet_id:'mel'},{...h.add('sache',8),pet_id:'luna'},h.pickup])]);expect((await h.state()).operations.cart.items).toMatchObject([{petId:'mel'},{petId:'luna'}]);await finish();await assertItems([{product_id:'racao-a',quantity_milliunits:1000},{product_id:'sache',quantity_milliunits:8000}]);break
   case 29:
    await h.run(['Mel banho e tosa','não, só banho às 9 amanhã'],[openAgenda,await book()]);await finish('appointment_create');expect((await h.db.prepare('SELECT service_id FROM appointment_services WHERE tenant_id=?').bind(h.tenant).all()).results).toEqual([{service_id:'banho'}]);break
   case 30:
    await h.run('quero 2 Ração A para retirar',[openCart,h.update([h.add('racao-a',2),h.pickup])]);await h.run(['sim','espera, quero só 1'],[h.update([{action:'set_quantity',item_id:'racao-a',quantity:1}])]);expect((await h.saleRows()).results).toEqual([]);await finish();await assertItems([{product_id:'racao-a',quantity_milliunits:1000}]);break
  }
  expect(await h.db.prepare('SELECT COUNT(*) count FROM payments WHERE tenant_id=?').bind(h.tenant).first()).toEqual({count:0})
  for(const row of (await h.saleRows()).results.filter(r=>r.id!=='history'))expect(row.status).toBe('pending')
  expect(h.transcripts.length).toBeGreaterThan(0)
 }finally{h.close()}
}
