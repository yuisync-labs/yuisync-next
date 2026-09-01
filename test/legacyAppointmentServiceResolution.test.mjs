import assert from 'node:assert/strict'
import test from 'node:test'

import { projectLegacyCanonicalSnapshot } from '../scripts/migration/legacyCanonicalProjection.mjs'

test('resolves legacy appointment service references by canonical service code', () => {
  const tenant_id = 'tenant-1'
  const module_id = 'petshop'
  const scoped = (row) => ({ tenant_id,module_id,...row })
  const snapshot = projectLegacyCanonicalSnapshot({ tables:{
    petshop_services:[scoped({ id:'service-1',code:'banho',name:'Banho',group_type:'banho_tosa',active:true })],
    appointments:[scoped({
      id:'appointment-1',client_id:'client-1',pet_id:'pet-1',status:'agendado',
      service_items:[{ code:'banho',name:'Banho',group_type:'banho_tosa' }],
    })],
  } }, { tenantId:tenant_id,moduleId:module_id })

  assert.equal(snapshot.collections.appointment_services[0].service_id, 'service-1')
})
