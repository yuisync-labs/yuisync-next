import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'

const db = (env as EdgeEnv & { DB: D1Database }).DB

describe('services Luna does not offer', () => {
  it('leaves out zero-priced services and the ones the store hid', async () => {
    const now = Date.now(), tenant = 'luna-hidden-services'
    const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: 'hidden', customerAddress: '5532999990200', phoneNumberId: 'fixture', sourceMessageId: 'm', traceId: 'hidden', executionMode: 'fixture' as const }
    await db.batch([
      db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Serviços ocultos','active',?2,?2)`).bind(tenant, now),
      ...[['banho', 'Banho com tosa higiênica', 5500], ['higienica', 'Tosa higiênica', 0], ['detalhes', 'Tosa higiênica com detalhes', 2500]].map(([id, name, price]) =>
        db.prepare(`INSERT INTO services(tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,?2,?3,'banho_tosa',?4,60,'active',?5,?5)`).bind(tenant, id, name, price, now)),
      db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,version,updated_at_ms) VALUES(?1,'petshop',?2,1,?3)`).bind(tenant, JSON.stringify({ luna_hidden_service_ids: ['detalhes'] }), now),
    ])
    const found = await createLunaToolRegistry(db).execute('search_services', { query: 'higi' }, ctx) as { ok: boolean; data: { services: { id: string }[] } }
    expect(found.data.services.map(s => s.id)).toEqual(['banho'])
  })
})
