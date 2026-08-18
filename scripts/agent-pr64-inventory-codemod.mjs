import fs from 'node:fs'

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${label}: target not found in ${path}`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target is not unique in ${path}`)
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

// Register the native atomic inventory boundary in the Worker dispatcher.
replaceOnce(
  'apps/edge-api/src/index.ts',
  "import { handleFiscalApiRequest } from './fiscalApi'\n",
  "import { handleFiscalApiRequest } from './fiscalApi'\nimport { handleInventoryAdjustmentRequest } from './inventoryAdjustment'\n",
  'inventory handler import',
)
replaceOnce(
  'apps/edge-api/src/index.ts',
  `    const managedUsersResponse = await handleManagedUsersApiRequest(request, bindings)\n    if (managedUsersResponse) return respond(managedUsersResponse)\n\n    const petshopPlansResponse = await handlePetshopPlansApiRequest(request, bindings)`,
  `    const managedUsersResponse = await handleManagedUsersApiRequest(request, bindings)\n    if (managedUsersResponse) return respond(managedUsersResponse)\n\n    const inventoryAdjustmentResponse = await handleInventoryAdjustmentRequest(request, bindings)\n    if (inventoryAdjustmentResponse) return respond(inventoryAdjustmentResponse)\n\n    const petshopPlansResponse = await handlePetshopPlansApiRequest(request, bindings)`,
  'inventory handler dispatch',
)

// Product metadata writes must never restore an old inventory snapshot.
replaceOnce(
  'apps/edge-api/src/compatApiRuntime.js',
  "const m={...old,...raw};await db.batch([",
  "const m={...old,...raw};if(old&&Object.prototype.hasOwnProperty.call(raw,'stock_quantity'))throw new Error('STOCK_MUTATION_REQUIRES_INVENTORY_COMMAND');await db.batch([",
  'reject legacy absolute stock updates',
)
replaceOnce(
  'apps/edge-api/src/compatApiRuntime.js',
  "ON CONFLICT(tenant_id,module_id,product_id) DO UPDATE SET on_hand_milliunits=excluded.on_hand_milliunits,reorder_milliunits=excluded.reorder_milliunits,updated_at_ms=excluded.updated_at_ms",
  "ON CONFLICT(tenant_id,module_id,product_id) DO UPDATE SET reorder_milliunits=excluded.reorder_milliunits,updated_at_ms=excluded.updated_at_ms",
  'metadata cannot overwrite stock balance',
)

const hookPath = 'src/shared/hooks/useProducts.js'
replaceOnce(
  hookPath,
  "import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../lib/tenant'\n",
  "import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../lib/tenant'\nimport { adjustInventoryCommand } from '../lib/inventoryCommands'\n",
  'inventory command import',
)

replaceOnce(
  hookPath,
  `  const update = useCallback(async (id, payload) => {\n    assertActiveTenant(activeTenantId, 'salvar o produto')\n    const payloadClean = { ...payload }\n    if (payloadClean.upsell_product) delete payloadClean.upsell_product\n\n    const { data, error } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {\n      let q = supabase\n        .from('products')\n        .update(payloadClean)\n        .eq('id', id)\n        .eq('module_id', activeModuleId)\n        .select(BASE_SELECT)\n        .single()\n      q = applyTenantFilter(q, activeTenantId, includeTenant)\n      return q\n    })\n\n    if (error) throw error\n    setProducts(prev => prev.map(p => p.id === id ? data : p))\n    return data\n  }, [activeModuleId, activeTenantId])`,
  `  const update = useCallback(async (id, payload) => {\n    assertActiveTenant(activeTenantId, 'salvar o produto')\n    const payloadClean = { ...payload }\n    if (payloadClean.upsell_product) delete payloadClean.upsell_product\n    const requestedStock = Object.prototype.hasOwnProperty.call(payloadClean, 'stock_quantity')\n      ? Math.max(0, Number(payloadClean.stock_quantity) || 0)\n      : null\n    delete payloadClean.stock_quantity\n\n    const { data, error } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {\n      let q = supabase\n        .from('products')\n        .update(payloadClean)\n        .eq('id', id)\n        .eq('module_id', activeModuleId)\n        .select(BASE_SELECT)\n        .single()\n      q = applyTenantFilter(q, activeTenantId, includeTenant)\n      return q\n    })\n\n    if (error) throw error\n    let next = data\n    if (requestedStock !== null) {\n      const currentStock = Number(data?.stock_quantity || 0)\n      const delta = requestedStock - currentStock\n      if (Math.abs(delta) > 0.0005) {\n        const adjustment = await adjustInventoryCommand({\n          tenantId: activeTenantId,\n          moduleId: activeModuleId,\n          productId: id,\n          delta,\n          movementType: 'adjustment',\n          reason: 'Ajuste de estoque pela edição do produto',\n        })\n        next = { ...data, stock_quantity: adjustment.stock_after }\n      }\n    }\n    setProducts(prev => prev.map(p => p.id === id ? next : p))\n    return next\n  }, [activeModuleId, activeTenantId])`,
  'product metadata and stock split',
)

replaceOnce(
  hookPath,
  `    if (product) {\n      // PRODUTO JÁ EXISTE: Aumentar estoque e atualizar custo\n      const newQty = (product.stock_quantity || 0) + parseFloat(item.qnt)\n      \n      // Atualizamos o custo se o novo for diferente\n      const newCost = parseFloat(item.val)\n      \n      return await update(product.id, { \n        stock_quantity: newQty,\n        cost_price: newCost,\n        updated_at: new Date().toISOString()\n      })\n    } else {\n      // PRODUTO NOVO: Criar no banco\n      return await create({\n        name: item.name,\n        barcode: item.barcode !== 'SEM GTIN' ? item.barcode : null,\n        stock_quantity: parseFloat(item.qnt),\n        cost_price: parseFloat(item.val),\n        price: parseFloat(item.val) * 1.5, // Sugestão de margem de 50% inicial\n        category: 'Importação XML',\n        active: true,\n        min_stock: 1\n      })\n    }\n  }, [activeModuleId, getByBarcode, update, create])`,
  `    const quantity = Math.max(0, Number.parseFloat(item.qnt) || 0)\n    const newCost = Math.max(0, Number.parseFloat(item.val) || 0)\n\n    if (product) {\n      if (quantity > 0) {\n        await adjustInventoryCommand({\n          tenantId: activeTenantId,\n          moduleId: activeModuleId,\n          productId: product.id,\n          delta: quantity,\n          movementType: 'purchase',\n          reason: 'Entrada de mercadoria via XML',\n          unitCostCents: Math.round(newCost * 100),\n        })\n      }\n      return update(product.id, {\n        cost_price: newCost,\n        updated_at: new Date().toISOString(),\n      })\n    }\n\n    const created = await create({\n      name: item.name,\n      barcode: item.barcode !== 'SEM GTIN' ? item.barcode : null,\n      stock_quantity: 0,\n      cost_price: newCost,\n      price: newCost * 1.5, // Sugestão de margem de 50% inicial\n      category: 'Importação XML',\n      active: true,\n      min_stock: 1,\n    })\n    if (quantity <= 0) return created\n    const adjustment = await adjustInventoryCommand({\n      tenantId: activeTenantId,\n      moduleId: activeModuleId,\n      productId: created.id,\n      delta: quantity,\n      movementType: 'purchase',\n      reason: 'Entrada inicial de mercadoria via XML',\n      unitCostCents: Math.round(newCost * 100),\n    })\n    const next = { ...created, stock_quantity: adjustment.stock_after }\n    setProducts(prev => prev.map(p => p.id === created.id ? next : p))\n    return next\n  }, [activeModuleId, activeTenantId, getByBarcode, update, create])`,
  'xml stock uses movement boundary',
)

replaceOnce(
  hookPath,
  `  const adjustStock = useCallback(async (id, delta) => {\n    assertActiveTenant(activeTenantId, 'ajustar o estoque')\n    const { data: current } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {\n      let q = supabase\n        .from('products')\n        .select('stock_quantity')\n        .eq('id', id)\n        .eq('module_id', activeModuleId)\n        .single()\n      q = applyTenantFilter(q, activeTenantId, includeTenant)\n      return q\n    })\n\n    const newQty = Math.max(0, (current?.stock_quantity || 0) + delta)\n    return update(id, { stock_quantity: newQty })\n  }, [activeModuleId, activeTenantId, update])`,
  `  const adjustStock = useCallback(async (id, delta) => {\n    assertActiveTenant(activeTenantId, 'ajustar o estoque')\n    const adjustment = await adjustInventoryCommand({\n      tenantId: activeTenantId,\n      moduleId: activeModuleId,\n      productId: id,\n      delta,\n      movementType: 'adjustment',\n      reason: 'Ajuste manual de estoque',\n    })\n    setProducts(prev => prev.map(p => p.id === id ? { ...p, stock_quantity: adjustment.stock_after } : p))\n    return adjustment\n  }, [activeModuleId, activeTenantId])`,
  'manual stock uses movement boundary',
)

console.log('PR64 inventory boundary codemod applied.')
