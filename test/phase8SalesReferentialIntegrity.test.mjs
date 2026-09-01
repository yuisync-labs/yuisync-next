import assert from 'node:assert/strict'
import test from 'node:test'

import { projectOperationalSnapshot } from '../scripts/migration/phase8OperationalProjection.mjs'

test('drops sale items whose legacy sale failed canonical total validation', () => {
  const tenant_id = 'tenant-1'
  const module_id = 'petshop'
  const scoped = (row) => ({ tenant_id,module_id,...row })
  const snapshot = projectOperationalSnapshot({ tables:{
    sales:[
      scoped({ id:'valid-sale',subtotal:10,discount:0,total:10,status:'completed',payment_method:'pix' }),
      scoped({ id:'invalid-sale',subtotal:10,discount:0,total:99,status:'completed',payment_method:'pix' }),
    ],
    sale_items:[
      scoped({ id:'item-1',sale_id:'valid-sale',product_id:'product-1',quantity:1,unit_price:10,subtotal:10 }),
      scoped({ id:'item-2',sale_id:'invalid-sale',product_id:'product-1',quantity:1,unit_price:10,subtotal:10 }),
    ],
  } }, { tenantId:tenant_id,moduleId:module_id })

  assert.deepEqual(snapshot.collections.sales.map((sale) => sale.id), ['valid-sale'])
  assert.deepEqual(snapshot.collections.sale_items.map((item) => item.sale_id), ['valid-sale'])
  assert.deepEqual(snapshot.collections.payments.map((payment) => payment.sale_id), ['valid-sale'])
  assert.equal(snapshot.collections.payment_splits.length, 1)
})

test('keeps sale item positions stable when unrelated source rows are added', () => {
  const tenant_id = 'tenant-1'
  const module_id = 'petshop'
  const scoped = (row) => ({ tenant_id,module_id,...row })
  const sale = scoped({ id:'sale-1',subtotal:20,discount:0,total:20,status:'completed' })
  const existing = scoped({ id:'item-z',sale_id:'sale-1',product_id:'product-1',quantity:1,unit_price:20,subtotal:20 })
  const project = (saleItems) => projectOperationalSnapshot({ tables:{ sales:[sale],sale_items:saleItems } }, { tenantId:tenant_id,moduleId:module_id })

  const before = project([existing]).collections.sale_items.find((item) => item.product_id === 'product-1')
  const after = project([
    scoped({ id:'item-a',sale_id:'sale-1',product_id:'product-2',quantity:1,unit_price:0,subtotal:0 }),
    existing,
  ]).collections.sale_items.find((item) => item.product_id === 'product-1')

  assert.equal(after.position, before.position)
  assert.ok(Number.isSafeInteger(after.position))
})
