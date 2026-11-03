import type {createLiveHarness} from './liveHarness'
import store from './quatropatas-store.json'
import {CUSTOMER,PETS,type SimScenario} from './simulatorScenarios'
type Harness=Awaited<ReturnType<typeof createLiveHarness>>
// Turns the fixture tenant into a copy of the QuatroPatas catalogue and rules
// (services, prices, MotoDog, delivery, hours), with fictitious customers.
export async function applyQuatroPatasStore(h:Harness,s:SimScenario){
 const t=h.tenant,now=Date.now()
 await h.db.batch([
  ...['catalog_product_profile_values','catalog_product_profile_species','catalog_product_profiles','catalog_product_species','catalog_product_attributes','inventory_balances','catalog_products','services','transport_options'].map(table=>h.db.prepare(`DELETE FROM ${table} WHERE tenant_id=?`).bind(t)),
  ...store.services.map(v=>h.db.prepare("INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms,species_target,min_weight_grams,max_weight_grams,description) VALUES(?,'petshop',?,?,?,?,?,?,'active',?,?,?,?,?,?)").bind(t,v.id,v.id,v.name,v.group_type,v.price_cents,v.duration_min,now,now,v.species_target,v.min_weight_grams,v.max_weight_grams,v.description||null)),
  ...store.products.flatMap(p=>[
   h.db.prepare("INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,category,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,?,?,?,'active',?,?)").bind(t,p.id,p.name,p.price_cents,p.category,now,now),
   h.db.prepare("INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?,'petshop',?,?,0,0,1,?)").bind(t,p.id,p.stock_units*1000,now),
  ]),
  ...store.transport.map(o=>h.db.prepare("INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,pickup_required,dropoff_required,outside_city,max_weight_grams,status,sort_order) VALUES(?,'petshop',?,?,?,?,?,?,?,'active',?)").bind(t,o.id,o.label,o.fee_cents,o.pickup_required,o.dropoff_required,o.outside_city,o.max_weight_grams,o.sort_order)),
  h.db.prepare("UPDATE tenant_module_settings SET store_name=?,store_city=? WHERE tenant_id=?").bind(store.store.name,store.store.city,t),
  h.db.prepare("UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.store_business_hours',json(?),'$.petbot_business_hours',json(?),'$.delivery_coverage',json(?),'$.luna_hidden_service_ids',json(?)) WHERE tenant_id=?").bind(JSON.stringify(store.hours),JSON.stringify(store.hours),JSON.stringify(store.delivery_coverage),JSON.stringify(store.hidden_service_ids),t),
  h.db.prepare("UPDATE clients SET name=?,address=?,address_number=?,neighborhood=?,city=?,address_reference=? WHERE tenant_id=?").bind(CUSTOMER.name,CUSTOMER.street,CUSTOMER.number,CUSTOMER.neighborhood,CUSTOMER.city,CUSTOMER.reference,t),
  ...Object.values(PETS).map(p=>h.db.prepare("UPDATE pets SET name=?,species=?,breed=?,weight_kg=? WHERE tenant_id=? AND id=?").bind(p.name,p.species,p.breed,p.weightKg,t,p.id)),
 ])
 // A new customer: the chat phone matches no client.
 if(!s.registered)await h.db.batch([
  h.db.prepare("UPDATE clients SET phone='0000000001' WHERE tenant_id=?").bind(t),
  h.db.prepare("UPDATE chat_threads SET customer_name=NULL WHERE tenant_id=?").bind(t),
 ])
}
