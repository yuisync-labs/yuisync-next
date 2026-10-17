import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { ACTIVE_PET_RECOVERY_INSERT_SQL, planActivePetsRecovery } from '../../../scripts/migration/legacy-supabase/activePetsRecovery.mjs'

it('recupera vários pets atomicamente e protege reexecução, pet recente, inativo e edição concorrente', async () => {
  const db = (env as EdgeEnv & { DB: D1Database }).DB
  const tenantId = `pet-recovery-${crypto.randomUUID()}`
  await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Recovery','active',1,1)").bind(tenantId).run()
  try {
    await db.batch(['a', 'b', 'c', 'd'].map(id => db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,'active',1,2)").bind(tenantId, id)))
    const source = (id: string) => [id, '2026-07-20T00:00:00Z', 'First', 'dog', null, null, null, null, null, [{ name: 'First' }, { name: 'Second' }], null]
    const plan = planActivePetsRecovery({
      scope: { tenant_id: tenantId, module_id: 'petshop' }, now: 100,
      nextClients: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, created_at_ms: 1, updated_at_ms: 2 })),
      sourceRows: ['a', 'b', 'c', 'd'].map(source), existingPets: [], existingOwners: [],
    })
    await db.batch([
      db.prepare("UPDATE clients SET updated_at_ms=3 WHERE tenant_id=?1 AND module_id='petshop' AND id='b'").bind(tenantId),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','native','c','Recent','active',4,4)").bind(tenantId),
      db.prepare("INSERT INTO pets(tenant_id,module_id,id,client_id,name,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','d','d','Inactive','inactive',4,4)").bind(tenantId),
    ])
    // An invalid row makes the whole insert fail, rather than partially migrating.
    const broken = plan.rows.filter(row => row.client_id === 'a').map((row, i) => ({ ...row, species: i ? 'invalid' : row.species }))
    await expect(db.prepare(ACTIVE_PET_RECOVERY_INSERT_SQL).bind(tenantId, 'petshop', JSON.stringify(broken)).run()).rejects.toThrow()
    expect(await db.prepare("SELECT id FROM pets WHERE tenant_id=?1 AND module_id='petshop' AND client_id='a'").bind(tenantId).all()).toMatchObject({ results: [] })
    // SQL also protects an inactive pet introduced after the pre-write snapshot.
    const guardedRows = plan.rows
    const result = await db.prepare(ACTIVE_PET_RECOVERY_INSERT_SQL).bind(tenantId, 'petshop', JSON.stringify(guardedRows)).run()
    expect(result.meta.changes).toBe(2)
    const replay = await db.prepare(ACTIVE_PET_RECOVERY_INSERT_SQL).bind(tenantId, 'petshop', JSON.stringify(guardedRows)).run()
    expect(replay.meta.changes).toBe(0)
    const rows = await db.prepare("SELECT client_id,name,status FROM pets WHERE tenant_id=?1 AND module_id='petshop' ORDER BY client_id,name").bind(tenantId).all()
    expect(rows.results).toEqual([
      { client_id: 'a', name: 'First', status: 'active' }, { client_id: 'a', name: 'Second', status: 'active' },
      { client_id: 'c', name: 'Recent', status: 'active' }, { client_id: 'd', name: 'Inactive', status: 'inactive' },
    ])
  } finally {
    await db.prepare('DELETE FROM pets WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM clients WHERE tenant_id=?1').bind(tenantId).run()
    await db.prepare('DELETE FROM tenants WHERE id=?1').bind(tenantId).run()
  }
})
