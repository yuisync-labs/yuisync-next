import {env} from 'cloudflare:workers'
import {describe,it,expect} from 'vitest'
import {CERTIFICATION_LEDGER_SCHEMA,openCertificationLedger} from '../../../scripts/luna/certificationLedger'
const db=(env as EdgeEnv & {DB:D1Database}).DB
describe('Durable full-round certification accounting',()=>{
 it('charges bootstrap, SQL and its own accounting, then preserves totals on resume',async()=>{
  await db.prepare(CERTIFICATION_LEDGER_SCHEMA).run()
  const ledger=await openCertificationLedger(db,'ledger-resume','fingerprint')
  ledger.category('setup')
  await ledger.db.prepare('SELECT 1 AS n').all()
  ledger.category('runtime')
  await ledger.db.prepare('SELECT id FROM tenants LIMIT 2').all()
  const before=ledger.usage()
  expect(before.totalReads).toBeGreaterThanOrEqual(5)
  expect(before.reserved_reads).toBe(0)
  const resumed=await openCertificationLedger(db,'ledger-resume','fingerprint')
  expect(resumed.usage().totalReads).toBeGreaterThan(before.totalReads)
  await expect(openCertificationLedger(db,'ledger-resume','different')).rejects.toThrow('IDENTITY_OR_BUDGET_INVALID')
 })
 it('reserves before provider calls, records real tokens and includes SQL overhead',async()=>{
  await db.prepare(CERTIFICATION_LEDGER_SCHEMA).run()
  const ledger=await openCertificationLedger(db,'ledger-model','same')
  await ledger.reserveModel(5000)
  expect(ledger.usage().reserved_calls).toBe(1)
  await ledger.settleModel(5000,{promptTokens:100,completionTokens:50})
  expect(ledger.usage()).toMatchObject({calls:1,input_tokens:100,output_tokens:50,reserved_tokens:0,reserved_calls:0})
  expect(ledger.usage().admin_reads).toBeGreaterThanOrEqual(7)
 })
 it('blocks SQL and model reservations at absolute ceilings without invoking work',async()=>{
  await db.prepare(CERTIFICATION_LEDGER_SCHEMA).run()
  const ledger=await openCertificationLedger(db,'ledger-ceiling','same')
  await db.prepare('UPDATE luna_cert_budget SET runtime_reads=99500 WHERE round_id=?1').bind('ledger-ceiling').run()
  await expect(ledger.db.prepare('SELECT 1').all()).rejects.toThrow('TOTAL_READ_BUDGET_EXHAUSTED')
  await db.prepare('UPDATE luna_cert_budget SET runtime_reads=0,calls=120 WHERE round_id=?1').bind('ledger-ceiling').run()
  await expect(ledger.reserveModel(100)).rejects.toThrow('TOTAL_MODEL_BUDGET_EXHAUSTED')
 })
})
