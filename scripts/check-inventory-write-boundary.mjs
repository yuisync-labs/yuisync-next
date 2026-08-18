import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const fail = (message) => {
  console.error(`inventory write boundary: ${message}`)
  process.exitCode = 1
}

const index = read('apps/edge-api/src/index.ts')
const compat = read('apps/edge-api/src/compatApiRuntime.js')
const products = read('src/shared/hooks/useProducts.js')

if (!index.includes("import { handleInventoryAdjustmentRequest } from './inventoryAdjustment'")) {
  fail('native inventory handler is not imported by the Worker dispatcher')
}
if (!index.includes('await handleInventoryAdjustmentRequest(request, bindings)')) {
  fail('native inventory handler is not dispatched by the Worker')
}
if (!compat.includes('STOCK_MUTATION_REQUIRES_INVENTORY_COMMAND')) {
  fail('compat product mutations do not reject absolute stock updates')
}
if (compat.includes('on_hand_milliunits=excluded.on_hand_milliunits')) {
  fail('compat product metadata upsert can overwrite canonical on-hand stock')
}
if (!products.includes("import { adjustInventoryCommand } from '../lib/inventoryCommands'")) {
  fail('product hook does not use the native inventory command')
}
if (!products.includes("movementType: 'purchase'")) {
  fail('XML purchase path is not routed through inventory movements')
}
if (!products.includes("movementType: 'adjustment'")) {
  fail('manual stock adjustment path is not routed through inventory movements')
}
if (/select\(['\"]stock_quantity['\"]\)[\s\S]{0,900}stock_quantity:\s*newQty/.test(products)) {
  fail('legacy read-then-absolute-write stock adjustment has returned')
}

if (!process.exitCode) console.log('inventory write boundary: OK')
