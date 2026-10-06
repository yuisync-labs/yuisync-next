// Fault injection around the real D1 interface, used only by certification.
// It never chooses model tools or supplies scripted model answers.
export function oneAgendaTimeout(database:D1Database){
 let attempts=0,injected=false
 const db=new Proxy(database,{get(target,key){
  if(key==='prepare')return(sql:string)=>{
   const wrap=(raw:D1PreparedStatement):D1PreparedStatement=>new Proxy(raw,{get(statement,method){
    if(method==='bind')return(...values:unknown[])=>wrap(statement.bind(...values))
    if(method==='all'&&sql.includes('SELECT scheduled_at_ms,duration_min FROM appointments'))return async()=>{
     attempts++
     if(!injected){injected=true;throw new Error('FIXTURE_AGENDA_TIMEOUT')}
     return statement.all()
    }
    const value=Reflect.get(statement,method,statement)
    return typeof value==='function'?value.bind(statement):value
   }})
   return wrap(target.prepare(sql))
  }
  const value=Reflect.get(target,key,target)
  return typeof value==='function'?value.bind(target):value
 }})
 return {db,evidence:()=>({kind:'agenda_timeout_once',injected,attempts})}
}
export async function blockCanonicalAfternoon(database:D1Database,tenant:string){
 await database.batch([
  database.prepare(`UPDATE module_settings_extensions SET data_json=json_set(data_json,'$.petbot_booking_capacity',1) WHERE tenant_id=?1 AND module_id='petshop'`).bind(tenant),
  database.prepare(`INSERT INTO appointments(tenant_id,module_id,id,client_id,pet_id,scheduled_at_ms,duration_min,service_group,status,source,subtotal_cents,transport_fee_cents,version,created_at_ms,updated_at_ms) VALUES(?1,'petshop','occupied','cliente-maria','mel',?2,60,'banho_tosa','blocked','manual',0,0,1,?3,?3)`).bind(tenant,Date.parse('2026-10-07T17:00:00Z'),Date.now()),
 ])
 return {kind:'occupied_14h',injected:true,appointmentId:'occupied'}
}
export function loseFirstCommittedBatch(database:D1Database,tenant:string){
 let injected=false,commits=0
 const db=new Proxy(database,{get(target,key){
  if(key==='batch')return async(statements:D1PreparedStatement[])=>{
   const before=(await target.prepare('SELECT id FROM sales WHERE tenant_id=?1 LIMIT 2').bind(tenant).all()).results.length
   const result=await target.batch(statements)
   const after=(await target.prepare('SELECT id FROM sales WHERE tenant_id=?1 LIMIT 2').bind(tenant).all()).results.length
   if(after>before){commits++;if(!injected){injected=true;throw new Error('FIXTURE_RESPONSE_LOST_AFTER_PERSISTENCE')}}
   return result
  }
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
 }})
 return{db,evidence:()=>({injected,commits})}
}
export async function changePriceAndLastStock(database:D1Database,tenant:string){
 await database.batch([
  database.prepare("UPDATE catalog_products SET price_cents=10000 WHERE tenant_id=?1 AND module_id='petshop' AND id='racao-a'").bind(tenant),
  database.prepare("UPDATE inventory_balances SET on_hand_milliunits=1000 WHERE tenant_id=?1 AND module_id='petshop' AND product_id='racao-a'").bind(tenant),
 ])
}
export async function seedLastBenefit(database:D1Database,tenant:string){
 await database.batch([
  database.prepare(`INSERT INTO subscription_plans(tenant_id,module_id,id,name,price_cents,billing_cycle,services_json,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','plan','Último banho',5500,'monthly',?2,'active',?3,?3)`).bind(tenant,JSON.stringify([{service_type:'banho',qty_per_cycle:1}]),Date.now()),
  database.prepare(`INSERT INTO client_subscriptions(tenant_id,module_id,id,plan_id,client_id,status,started_at_ms,next_billing_date,services_used_json,created_at_ms,updated_at_ms,benefit_ledger_base_used_json) VALUES(?1,'petshop','subscription','plan','cliente-maria','active',?2,'2026-11-06','{}',?2,?2,'{}')`).bind(tenant,Date.now()),
 ])
}
