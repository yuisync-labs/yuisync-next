import { LUNA_SCENARIO_FIXTURE as f,LUNA_SCENARIO_CLOCK } from '../../apps/edge-api/test/fixtures/luna/designedScenarios'
export async function seedCertificationFixture(db:D1Database,tenant:string,conversation:string,id:number){
 const now=Date.parse(LUNA_SCENARIO_CLOCK.now),hours=Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),i<5?[{open:'08:00',close:'18:00'}]:[]]))
 const statements=[
  db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Luna fictional certification','active',?2,?2)`).bind(tenant,now),
  db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'internal',?3,'open',?4,?4,?4)`).bind(tenant,conversation,f.phone,now),
  db.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,store_city,created_at_ms,updated_at_ms) VALUES(?1,'petshop','Loja fictícia','Cidade Teste',?2,?2)`).bind(tenant,now),
  db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,JSON.stringify({petbot_timezone:LUNA_SCENARIO_CLOCK.timezone,petbot_booking_capacity:3,petbot_business_hours:hours,store_business_hours:hours,delivery_coverage:[{city:'Cidade Teste',neighborhood:'Centro',active:true,fee_cents:1500}]}),now),
  ...f.products.flatMap(p=>[
   db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?4,'active',?5,?5)`).bind(tenant,p.id,p.name,p.priceCents,now),
   db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop',?2,?3,0,0,1,?4)`).bind(tenant,p.id,p.units*1000,now),
  ]),
  ...f.services.map(s=>db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,?2,'banho_tosa',?3,?4,'active',?5,?5)`).bind(tenant,s.id,s.priceCents,s.durationMin,now)),
 ]
 if(id!==10)statements.push(db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,city,neighborhood,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'Maria',?3,'Cidade Teste','Centro','active',?4,?4)`).bind(tenant,f.customer,f.phone,now),...['mel','luna','thor'].map(pet=>db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,weight_kg,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?3,?2,'dog',8,'active',?4,?4)`).bind(tenant,pet,f.customer,now)))
 // Small chunks bound setup work and preserve exact fixture IDs.
 for(let i=0;i<statements.length;i+=8)await db.batch(statements.slice(i,i+8))
 if(id===7)for(let i=0;i<80;i++)await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,?5,?6,?7)`).bind(tenant,`previous-${i}`,conversation,i%2?'outbound':'inbound',i%2?'assistant':'customer',i%2?'Resposta neutra anterior':'Mensagem neutra anterior',now-100000+i*1000).run()
 if(id===18)await db.batch([
  ...['both','pickup'].map(option=>db.prepare(`INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order) VALUES(?1,'petshop',?2,?3,?4,20000,1,?5,0,'active',1)`).bind(tenant,option,option==='both'?'MotoDog buscar e levar':'MotoDog só buscar',option==='both'?2000:1000,option==='both'?1:0)),
  db.prepare(`INSERT INTO transport_resources VALUES(?1,'petshop','bike',1,'active')`).bind(tenant),
  ...['both','pickup'].map(option=>db.prepare(`INSERT INTO transport_option_resources VALUES(?1,'petshop',?2,'bike')`).bind(tenant,option)),
  db.prepare(`INSERT INTO transport_availability_windows VALUES(?1,'petshop','window','bike',?2,?3,1)`).bind(tenant,Date.parse('2026-10-07T12:00:00Z'),Date.parse('2026-10-07T15:00:00Z')),
 ])
}
