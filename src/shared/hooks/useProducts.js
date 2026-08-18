import { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useModuleCtx } from '../../context/ModuleContext'
import { useAuthCtx } from '../../context/AuthContext'
import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../lib/tenant'
import { adjustInventoryCommand } from '../lib/inventoryCommands'

const BASE_SELECT = `
  id, name, category, description, price, cost_price, stock_quantity,
  min_stock, species_target, image_url, active, created_at, updated_at, 
  barcode, upsell_link_id, bot_metadata
`
const PRODUCT_PAGE_SIZE = 1000

async function fetchAllProductPages(buildQuery) {
  const rows = []

  for (let from = 0; ; from += PRODUCT_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PRODUCT_PAGE_SIZE - 1)
    if (error) return { data: null, error }

    rows.push(...(data || []))
    if (!data || data.length < PRODUCT_PAGE_SIZE) break
  }

  return { data: rows, error: null }
}

function assertActiveTenant(tenantId, action = 'salvar') {
  if (!tenantId) throw new Error(`Selecione uma empresa ativa antes de ${action}.`)
}

export function useProducts() {
  const [products, setProducts]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const { activeModuleId } = useModuleCtx()
  const { activeTenantId } = useAuthCtx()

  const load = useCallback(async (filters = {}) => {
    if (!activeModuleId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        return fetchAllProductPages(() => {
          let q = supabase.from('products').select(BASE_SELECT).eq('module_id', activeModuleId).order('name')
          q = applyTenantFilter(q, activeTenantId, includeTenant)
          if (filters.category) q = q.eq('category', filters.category)
          if (filters.species) q = q.eq('species_target', filters.species)
          if (filters.activeOnly !== false) q = q.eq('active', true)
          if (filters.search) q = q.ilike('name', `%${filters.search}%`)
          return q
        })
      })

      if (err) throw err
      setProducts(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeModuleId, activeTenantId])

  const getById = useCallback(async (id) => {
    const { data } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let q = supabase
        .from('products')
        .select(BASE_SELECT)
        .eq('id', id)
        .eq('module_id', activeModuleId)
        .single()
      q = applyTenantFilter(q, activeTenantId, includeTenant)
      return q
    })

    return data
  }, [activeModuleId, activeTenantId])

  // Novo: Buscar produto por código de barras
  const getByBarcode = useCallback(async (barcode) => {
    if (!barcode) return null
    const { data } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let q = supabase
        .from('products')
        .select(BASE_SELECT)
        .eq('barcode', barcode)
        .eq('module_id', activeModuleId)
        .single()
      q = applyTenantFilter(q, activeTenantId, includeTenant)
      return q
    })

    return data
  }, [activeModuleId, activeTenantId])

  const create = useCallback(async (payload) => {
    assertActiveTenant(activeTenantId, 'salvar o produto')
    const { data, error } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      const insertPayload = buildTenantPayload({ ...payload, module_id: activeModuleId }, activeTenantId, includeTenant)
      return supabase
        .from('products')
        .insert(insertPayload)
        .select(BASE_SELECT)
        .single()
    })

    if (error) throw error
    setProducts(prev => [data, ...prev])
    return data
  }, [activeModuleId, activeTenantId])

  const update = useCallback(async (id, payload) => {
    assertActiveTenant(activeTenantId, 'salvar o produto')
    const payloadClean = { ...payload }
    if (payloadClean.upsell_product) delete payloadClean.upsell_product
    const requestedStock = Object.prototype.hasOwnProperty.call(payloadClean, 'stock_quantity')
      ? Math.max(0, Number(payloadClean.stock_quantity) || 0)
      : null
    delete payloadClean.stock_quantity

    const { data, error } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let q = supabase
        .from('products')
        .update(payloadClean)
        .eq('id', id)
        .eq('module_id', activeModuleId)
        .select(BASE_SELECT)
        .single()
      q = applyTenantFilter(q, activeTenantId, includeTenant)
      return q
    })

    if (error) throw error
    let next = data
    if (requestedStock !== null) {
      const currentStock = Number(data?.stock_quantity || 0)
      const delta = requestedStock - currentStock
      if (Math.abs(delta) > 0.0005) {
        const adjustment = await adjustInventoryCommand({
          tenantId: activeTenantId,
          moduleId: activeModuleId,
          productId: id,
          delta,
          movementType: 'adjustment',
          reason: 'Ajuste de estoque pela edição do produto',
        })
        next = { ...data, stock_quantity: adjustment.stock_after }
      }
    }
    setProducts(prev => prev.map(p => p.id === id ? next : p))
    return next
  }, [activeModuleId, activeTenantId])

  // Novo: Processar entrada de mercadoria via XML (Sincronização sugerida)
  const syncProductFromXml = useCallback(async (item) => {
    if (!activeModuleId) return null
    
    // 1. Tentar encontrar por código de barras (EAN)
    let product = null
    if (item.barcode && item.barcode !== 'SEM GTIN') {
      product = await getByBarcode(item.barcode)
    }

    // 2. Se não achou por código, tenta pelo nome exato (fallback)
    if (!product) {
      const { data } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let q = supabase
          .from('products')
          .select(BASE_SELECT)
          .eq('name', item.name)
          .eq('module_id', activeModuleId)
          .single()
        q = applyTenantFilter(q, activeTenantId, includeTenant)
        return q
      })
      product = data
    }

    const quantity = Math.max(0, Number.parseFloat(item.qnt) || 0)
    const newCost = Math.max(0, Number.parseFloat(item.val) || 0)

    if (product) {
      if (quantity > 0) {
        await adjustInventoryCommand({
          tenantId: activeTenantId,
          moduleId: activeModuleId,
          productId: product.id,
          delta: quantity,
          movementType: 'purchase',
          reason: 'Entrada de mercadoria via XML',
          unitCostCents: Math.round(newCost * 100),
        })
      }
      return update(product.id, {
        cost_price: newCost,
        updated_at: new Date().toISOString(),
      })
    }

    const created = await create({
      name: item.name,
      barcode: item.barcode !== 'SEM GTIN' ? item.barcode : null,
      stock_quantity: 0,
      cost_price: newCost,
      price: newCost * 1.5, // Sugestão de margem de 50% inicial
      category: 'Importação XML',
      active: true,
      min_stock: 1,
    })
    if (quantity <= 0) return created
    const adjustment = await adjustInventoryCommand({
      tenantId: activeTenantId,
      moduleId: activeModuleId,
      productId: created.id,
      delta: quantity,
      movementType: 'purchase',
      reason: 'Entrada inicial de mercadoria via XML',
      unitCostCents: Math.round(newCost * 100),
    })
    const next = { ...created, stock_quantity: adjustment.stock_after }
    setProducts(prev => prev.map(p => p.id === created.id ? next : p))
    return next
  }, [activeModuleId, activeTenantId, getByBarcode, update, create])

  const adjustStock = useCallback(async (id, delta) => {
    assertActiveTenant(activeTenantId, 'ajustar o estoque')
    const adjustment = await adjustInventoryCommand({
      tenantId: activeTenantId,
      moduleId: activeModuleId,
      productId: id,
      delta,
      movementType: 'adjustment',
      reason: 'Ajuste manual de estoque',
    })
    setProducts(prev => prev.map(p => p.id === id ? { ...p, stock_quantity: adjustment.stock_after } : p))
    return adjustment
  }, [activeModuleId, activeTenantId])

  const remove = useCallback(async (id) => {
    assertActiveTenant(activeTenantId, 'remover o produto')
    const { error } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let q = supabase
        .from('products')
        .update({ active: false })
        .eq('id', id)
        .eq('module_id', activeModuleId)
      q = applyTenantFilter(q, activeTenantId, includeTenant)
      return q
    })

    if (error) throw error
    setProducts(prev => prev.filter(p => p.id !== id))
  }, [activeModuleId, activeTenantId])

  const getCriticalStock = useCallback(async () => {
    if (!activeModuleId) return []
    try {
      const { data, error } = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        return fetchAllProductPages(() => {
          let q = supabase
            .from('products')
            .select(BASE_SELECT)
            .eq('module_id', activeModuleId)
            .eq('active', true)
            .order('name')
          q = applyTenantFilter(q, activeTenantId, includeTenant)
          return q
        })
      })

      if (error) throw error
      return (data || []).filter(p => p.stock_quantity <= p.min_stock)
    } catch (e) {
      console.error('Error fetching critical stock:', e)
      return []
    }
  }, [activeModuleId, activeTenantId])

  const stockStatus = (p) => {
    if (p.stock_quantity === 0)           return 'esgotado'
    if (p.stock_quantity <= p.min_stock)  return 'critico'
    return 'ok'
  }

  return {
    products, loading, error,
    load, getById, getByBarcode, create, update, adjustStock, remove,
    syncProductFromXml, stockStatus, getCriticalStock
  }
}
