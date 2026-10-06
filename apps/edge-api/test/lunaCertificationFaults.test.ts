import {env} from 'cloudflare:workers'
import {describe,it,expect} from 'vitest'
import {seedCertificationFixture} from '../../../scripts/luna/certificationFixtures'
import {changePriceAndLastStock,seedLastBenefit,loseFirstCommittedBatch} from '../../../scripts/luna/certificationFaults'
import {operationalAssertions} from '../../../scripts/luna/certificationAssertions'
import {certificationSnapshot} from '../../../scripts/luna/stagingWorker'
const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('Certification faults and invariant parity',()=>{
 it('changes persisted price/stock and provisions exactly one real package benefit',async()=>{
  const tenant='cert-fault-finance';await seedCertificationFixture(db,tenant,'scenario-15',15)
  await changePriceAndLastStock(db,tenant);await seedLastBenefit(db,tenant)
  expect(await db.prepare("SELECT price_cents FROM catalog_products WHERE tenant_id=?1 AND id='racao-a'").bind(tenant).first()).toEqual({price_cents:10000})
  expect(await db.prepare("SELECT on_hand_milliunits,reserved_milliunits FROM inventory_balances WHERE tenant_id=?1 AND product_id='racao-a'").bind(tenant).first()).toEqual({on_hand_milliunits:1000,reserved_milliunits:0})
  expect((await db.prepare('SELECT services_json FROM subscription_plans WHERE tenant_id=?1').bind(tenant).all()).results).toHaveLength(1)
 })
 it('throws only after a real persisted sale batch and never on the next batch',async()=>{
  const tenant='cert-fault-lost';await seedCertificationFixture(db,tenant,'scenario-14',14)
  const fault=loseFirstCommittedBatch(db,tenant)
  const insert=db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,source,fulfillment_type,client_id,status,subtotal_cents,total_cents,created_at_ms,updated_at_ms) VALUES(?1,'petshop','sale','fixture-sale','whatsapp','counter','cliente-maria','pending',9000,9000,?2,?2)`).bind(tenant,Date.now())
  await expect(fault.db.batch([insert])).rejects.toThrow('FIXTURE_RESPONSE_LOST_AFTER_PERSISTENCE')
  expect((await db.prepare('SELECT id FROM sales WHERE tenant_id=?1').bind(tenant).all()).results).toEqual([{id:'sale'}])
  await fault.db.batch([db.prepare('SELECT 1')])
  expect(fault.evidence()).toEqual({injected:true,commits:1})
 })
 it('does not accept an empty/cart-only snapshot or corrupted accounting as a valid operation',async()=>{
  const tenant='cert-assert';await seedCertificationFixture(db,tenant,'scenario-1',1)
  const after=await certificationSnapshot(db,tenant,'scenario-1')
  expect(await operationalAssertions({id:1,turn:0,total:3,tenant,before:after,after,tools:[],faults:[]})).toEqual([])
  const corrupt=structuredClone(after) as any
  corrupt.tables.inventory_balances[0].reserved_milliunits=1000
  expect(await operationalAssertions({id:1,turn:0,total:3,tenant,before:after,after:corrupt,tools:[],faults:[]})).toContain('RESERVATION_BALANCE_MISMATCH')
  corrupt.tables.clients[0].tenant_id='foreign'
  expect(await operationalAssertions({id:1,turn:0,total:3,tenant,before:after,after:corrupt,tools:[],faults:[]})).toContain('CROSS_SCOPE_ROW')
 })
})
