import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const db = (env as EdgeEnv & { DB: D1Database }).DB
const now = 1000

async function seedTenant(id: string) {
  await db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?,?,?,'active',?,?)`)
    .bind(id,id,id,now,now).run()
}

async function seedSale(tenantId: string) {
  await db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','client','Tutor','active',?,?)`).bind(tenantId,now,now).run()
  await db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,client_id,source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','sale','sale-op','client','manual','counter',1000,0,0,1000,'completed',?,?)`).bind(tenantId,now,now).run()
}

describe('runtime core invariants', () => {
  it('deduplica mensagem externa no mesmo tenant/module', async () => {
    const t='tenant-chat'; await seedTenant(t)
    await db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,status,created_at_ms,updated_at_ms) VALUES(?,'petshop','thread','whatsapp','open',?,?)`).bind(t,now,now).run()
    const sql=`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?,'petshop',?,'thread','wamid-1','inbound','customer','oi',?)`
    await db.prepare(sql).bind(t,'m1',now).run()
    await expect(db.prepare(sql).bind(t,'m2',now).run()).rejects.toThrow()
  })

  it('OperationState checkpoint exige JSON válido e versão positiva', async () => {
    const t='tenant-operation'; await seedTenant(t)
    await expect(db.prepare(`INSERT INTO operation_checkpoints(tenant_id,module_id,id,operation_type,stage,facts_json,confirmations_json,status,version,updated_at_ms) VALUES(?,'petshop','op','bath_booking','collecting_pet','{}','[]','running',1,?)`).bind(t,now).run()).resolves.toMatchObject({success:true})
    await expect(db.prepare(`UPDATE operation_checkpoints SET facts_json='{' WHERE tenant_id=? AND module_id='petshop' AND id='op'`).bind(t).run()).rejects.toThrow()
  })

  it('efeito da operação é idempotente pela chave dentro da operação', async () => {
    const t='tenant-effect'; await seedTenant(t)
    await db.prepare(`INSERT INTO operation_checkpoints(tenant_id,module_id,id,operation_type,stage,facts_json,confirmations_json,status,version,updated_at_ms) VALUES(?,'petshop','op','sale','confirming','{}','[]','running',1,?)`).bind(t,now).run()
    const sql=`INSERT INTO operation_effects(tenant_id,module_id,operation_id,effect_key,effect_type,payload_json,status,attempt_count,created_at_ms,updated_at_ms) VALUES(?,'petshop','op','charge','payment','{}','pending',0,?,?)`
    await db.prepare(sql).bind(t,now,now).run()
    await expect(db.prepare(sql).bind(t,now,now).run()).rejects.toThrow()
  })

  it('reserva uma única intenção por operation key de agendamento', async () => {
    const t='tenant-appointment-command'; await seedTenant(t)
    const fingerprintA='a'.repeat(64)
    const fingerprintB='b'.repeat(64)
    const sql=`INSERT INTO appointment_command_registry(
      tenant_id,module_id,operation_key,appointment_id,operation_fingerprint,status,created_at_ms,updated_at_ms
    ) VALUES(?,'petshop','appointment-booking:key','appointment-a',?,'reserved',?,?)`
    await db.prepare(sql).bind(t,fingerprintA,now,now).run()
    await expect(db.prepare(sql.replace("'appointment-a'", "'appointment-b'")).bind(t,fingerprintB,now,now).run()).rejects.toThrow()

    const row = await db.prepare(`SELECT appointment_id,operation_fingerprint,status FROM appointment_command_registry WHERE tenant_id=? AND module_id='petshop' AND operation_key='appointment-booking:key'`)
      .bind(t).first<{appointment_id:string;operation_fingerprint:string;status:string}>()
    expect(row).toEqual({ appointment_id:'appointment-a', operation_fingerprint:fingerprintA, status:'reserved' })
  })

  it('documento fiscal e outbox recusam operação duplicada', async () => {
    const t='tenant-fiscal'; await seedTenant(t); await seedSale(t)
    const fiscal=`INSERT INTO fiscal_documents(
      tenant_id,module_id,id,sale_id,operation_key,document_type,provider,environment,status,
      request_hash,schema_version,ruleset_version,readiness_json,created_at_ms,updated_at_ms
    ) VALUES(?,'petshop',?,'sale','fiscal-op','nfe','sefaz_mg','homologation','pending',?,'test-schema','test-rules','[]',?,?)`
    const hash='a'.repeat(64)
    await db.prepare(fiscal).bind(t,'doc1',hash,now,now).run()
    await expect(db.prepare(fiscal).bind(t,'doc2',hash,now,now).run()).rejects.toThrow()
    const outbox=`INSERT INTO effect_outbox(tenant_id,module_id,id,operation_key,aggregate_type,aggregate_id,event_type,payload_json,status,attempt_count,available_at_ms,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'op','sale','sale','fiscal.issue','{}','pending',0,?,?,?)`
    await db.prepare(outbox).bind(t,'o1',now,now,now).run()
    await expect(db.prepare(outbox).bind(t,'o2',now,now,now).run()).rejects.toThrow()
  })
})
