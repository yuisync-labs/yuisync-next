import assert from 'node:assert/strict'
import test from 'node:test'

import { projectOperationalSnapshot } from '../scripts/migration/phase8OperationalProjection.mjs'

test('normalizes legacy Sunday and manual autonomy to current D1 constraints', () => {
  const tenant_id = 'tenant-1'
  const module_id = 'petshop'
  const snapshot = projectOperationalSnapshot({
    tables:{
      settings:[{
        tenant_id,module_id,petbot_autonomy_mode:'manual',
        petbot_business_hours:{ '7':[{ open:'08:00',close:'17:00' }] },
      }],
    },
  }, { tenantId:tenant_id,moduleId:module_id })
  assert.equal(snapshot.collections.module_operational_settings[0].autonomy_mode, 'disabled')
  assert.deepEqual(snapshot.collections.booking_hours, [{
    tenant_id,module_id,weekday:0,opens_minute:480,closes_minute:1020,active:1,
  }])
})

test('adds a supported transport option referenced by appointments but absent from settings', () => {
  const tenant_id = 'tenant-1'
  const module_id = 'petshop'
  const snapshot = projectOperationalSnapshot({ tables:{
    settings:[{ tenant_id,module_id,pet_transport_options:[{ id:'buscar_e_levar',label:'Buscar',fee:10 }] }],
    appointments:[{ tenant_id,module_id,id:'a1',client_id:'c1',pet_id:'p1',transport_mode:'buscar_e_levar_fora_muriae' }],
  } }, { tenantId:tenant_id,moduleId:module_id })
  assert.ok(snapshot.collections.transport_options.some((option) => option.id === 'buscar_e_levar_fora_muriae'))
})
