import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'
import { mutateSettings, selectRows } from '../src/compatApiRuntime'

it('MotoDog options in Settings are the transport_options Luna quotes from', async () => {
  const db = (env as EdgeEnv).DB!, tenant = 'transport-settings-' + crypto.randomUUID().slice(0, 8), now = Date.now(), scope = { tenantId: tenant, moduleId: 'petshop' }
  await db.batch([
    db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Fixture','active',?2,?2)`).bind(tenant, now),
    db.prepare(`INSERT INTO tenant_module_settings(tenant_id,module_id,store_name,store_city,created_at_ms,updated_at_ms) VALUES(?1,'petshop','Fixture','Muriaé',?2,?2)`).bind(tenant, now),
    db.prepare(`INSERT INTO transport_options(tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order) VALUES(?1,'petshop','somente_buscar','Somente buscar',1000,10000,1,0,0,'active',0)`).bind(tenant),
  ])
  const read = async () => (await selectRows(db, 'settings', { read: 'settings' }, {}, scope)).rows[0] as Record<string, unknown>
  expect((await read()).pet_transport_options).toEqual([{ id: 'somente_buscar', label: 'Somente buscar', fee: '10.00', maxWeightKg: '10', active: true }])
  await mutateSettings(db, { pix_key: 'pix-teste@exemplo.com', pet_transport_options: [{ id: 'somente_buscar', label: 'Só buscar', fee: '12.50', maxWeightKg: '8', active: true }, { id: 'buscar_e_levar_fora_muriae', label: 'Buscar e levar (fora de Muriaé)', fee: '30.00', maxWeightKg: '10', active: false }] }, scope)
  const rows = (await db.prepare(`SELECT id,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status FROM transport_options WHERE tenant_id=?1 ORDER BY sort_order`).bind(tenant).all()).results
  expect(rows).toEqual([
    { id: 'somente_buscar', fee_cents: 1250, max_weight_grams: 8000, pickup_required: 1, dropoff_required: 0, outside_city: 0, status: 'active' },
    { id: 'buscar_e_levar_fora_muriae', fee_cents: 3000, max_weight_grams: 10000, pickup_required: 1, dropoff_required: 1, outside_city: 1, status: 'inactive' },
  ])
  const ext = await db.prepare(`SELECT data_json FROM module_settings_extensions WHERE tenant_id=?1`).bind(tenant).first<{ data_json: string }>()
  expect(JSON.parse(ext!.data_json)).toEqual({ pix_key: 'pix-teste@exemplo.com' })
})
