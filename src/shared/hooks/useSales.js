import { useState, useCallback } from 'react'
import { supabase, todayISO, fmtCurrency, getTimezoneOffset } from '../../lib/supabase'
import { checkoutPetshop, issueFiscalForSale as issueFiscalForSaleApi } from '../../lib/api'
import { useModuleCtx } from '../../context/ModuleContext'
import { useAuthCtx } from '../../context/AuthContext'
import { applyTenantFilter, buildTenantPayload, runWithTenantFallback } from '../../lib/tenant'

function hasColumnError(error, columnName) {
  return String(error?.message || '').toLowerCase().includes(columnName.toLowerCase())
}

function isOnConflictConstraintError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('no unique or exclusion constraint matching the on conflict specification')
}

function isFiscalRuntimeMissingError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false
  return (
    message.includes('fiscal_documents')
    || message.includes('fiscal_status')
    || message.includes('queue_fiscal_document_for_sale')
  ) && (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('relation')
    || message.includes('function')
    || message.includes('column')
  )
}

function isSalePaymentSplitSchemaError(error) {
  const message = String(error?.message || '').toLowerCase()
  if (!message) return false
  return message.includes('sale_payment_splits') && (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('relation')
    || message.includes('column')
  )
}

function mapSalesRows(data = []) {
  return data.map((sale) => {
    const client = sale.clients || null
    const normalized = {
      ...sale,
      customer_name: sale.customer_name || client?.name || 'Balcao',
      customer_phone: sale.customer_phone || client?.phone || null,
      ...(client ? {
        pets: {
          pet_name: client.details?.pet_name || client.name || '',
        },
      } : {}),
    }
    delete normalized.clients
    return normalized
  })
}

function assertActiveTenant(tenantId, action = 'salvar') {
  if (!tenantId) throw new Error(`Selecione uma empresa ativa antes de ${action}.`)
}

function salesSelect({ includeFulfillment = true, includeDeliveryFee = true, includeProfiles = true, includeClients = true } = {}) {
  const fields = [
    'id',
    'customer_name',
    'customer_phone',
    'payment_method',
    'subtotal',
    'discount',
    includeDeliveryFee ? 'delivery_fee' : null,
    'total_price',
    'status',
    'notes',
    'source',
    includeFulfillment ? 'fulfillment_type' : null,
    'created_at',
    includeProfiles ? 'profiles!sales_profile_id_fkey ( id, full_name )' : null,
    includeClients ? 'clients ( id, name, details )' : null,
    'sale_items ( id, quantity, unit_price, subtotal, upsell, products ( id, name, category ) )',
  ].filter(Boolean)

  return fields.join(', ')
}

function insertSaleSelect({ includeClient = true, includeFulfillment = true, includeDeliveryFee = true } = {}) {
  const fields = [
    'id',
    includeClient ? 'client_id' : null,
    'customer_name',
    'customer_phone',
    'total_price',
    includeDeliveryFee ? 'delivery_fee' : null,
    'payment_method',
    'source',
    includeFulfillment ? 'fulfillment_type' : null,
    'created_at',
  ].filter(Boolean)
  return fields.join(', ')
}

async function syncSaleToChatTimeline(moduleId, tenantId, sale, cartItems) {
  if (!sale?.customer_phone && !sale?.client_id) return

  const sessionResponse = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('chat_sessions')
      .select('id')
      .eq('module_id', moduleId)
      .order('last_message_at', { ascending: false })
      .limit(1)

    query = applyTenantFilter(query, tenantId, includeTenant)
    if (sale.client_id) query = query.eq('client_id', sale.client_id)
    else query = query.eq('customer_phone', sale.customer_phone)

    return query.maybeSingle()
  })

  if (sessionResponse.error) throw sessionResponse.error
  let session = sessionResponse.data

  const now = sale.created_at || new Date().toISOString()
  const itemSummary = cartItems
    .map((item) => `${item.quantity}x ${item.product?.name || 'Item'}`)
    .slice(0, 4)
    .join(', ')

  if (!session) {
    const createdResponse = await runWithTenantFallback(tenantId, async (includeTenant) => {
      const payload = buildTenantPayload({
        module_id: moduleId,
        customer_phone: sale.customer_phone || `cliente-${sale.client_id}`,
        customer_name: sale.customer_name || 'Cliente',
        client_id: sale.client_id || null,
        status: 'human',
        intent: 'pos_venda',
        channel: 'interno',
        last_message_at: now,
      }, tenantId, includeTenant)

      return supabase
        .from('chat_sessions')
        .insert(payload)
        .select('id')
        .single()
    })

    if (createdResponse.error) throw createdResponse.error
    session = createdResponse.data
  }

  const saleMessage = [
    `Venda PDV concluida: ${fmtCurrency(sale.total_price || 0)} via ${sale.payment_method || 'pagamento nao informado'}.`,
    sale.source === 'whatsapp' && sale.fulfillment_type && sale.fulfillment_type !== 'balcao'
      ? `Fluxo operacional: ${sale.fulfillment_type}.`
      : null,
    itemSummary ? `Itens: ${itemSummary}.` : null,
  ].filter(Boolean).join(' ')

  const { error: messageError } = await supabase
    .from('chat_messages')
    .insert({
      session_id: session.id,
      role: 'human_agent',
      content: saleMessage,
      metadata: { source: 'pdv', sale_id: sale.id },
      sent_at: now,
    })

  if (messageError) throw messageError

  await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('chat_sessions')
      .update({
        status: 'human',
        last_message_at: now,
      })
      .eq('id', session.id)

    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })
}

async function syncFiscalForSale(moduleId, tenantId, sale) {
  if (!sale?.id || moduleId !== 'petshop') {
    return { status: 'not_applicable' }
  }

  try {
    const apiResult = await issueFiscalForSaleApi(sale.id)
    if (apiResult?.status) {
      return apiResult
    }
  } catch (apiError) {
    console.warn('Falha no endpoint fiscal do backend, usando fallback direto no banco:', apiError)
  }

  const queueResponse = await runWithTenantFallback(tenantId, async (includeTenant) => {
    return supabase.rpc('queue_fiscal_document_for_sale', { p_sale_id: sale.id })
  })

  if (queueResponse.error) {
    if (isOnConflictConstraintError(queueResponse.error)) {
      throw new Error('Ajuste fiscal pendente no banco. Rode o SQL "database/petshop_fiscal_manual_mode_fix.sql".')
    }
    if (isFiscalRuntimeMissingError(queueResponse.error)) {
      return { status: 'runtime_missing' }
    }
    throw queueResponse.error
  }

  const invoiceResponse = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('invoices')
      .select('id, status, amount, invoice_nfe_url, fiscal_status, fiscal_document_id')
      .eq('module_id', moduleId)
      .eq('sale_id', sale.id)
      .limit(1)
      .maybeSingle()

    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })

  if (invoiceResponse.error) {
    if (hasColumnError(invoiceResponse.error, 'fiscal_status') || isFiscalRuntimeMissingError(invoiceResponse.error)) {
      return {
        status: 'ok',
        invoice: null,
        document: null,
      }
    }
    throw invoiceResponse.error
  }

  const invoice = invoiceResponse.data || null
  if (!invoice?.fiscal_document_id) {
    return {
      status: 'ok',
      invoice,
      document: null,
    }
  }

  const documentResponse = await runWithTenantFallback(tenantId, async (includeTenant) => {
    let query = supabase
      .from('fiscal_documents')
      .select('id, status, document_type, provider, environment, nfe_key, protocol_number, error_message, issued_at, created_at')
      .eq('id', invoice.fiscal_document_id)
      .maybeSingle()

    query = applyTenantFilter(query, tenantId, includeTenant)
    return query
  })

  if (documentResponse.error) {
    if (isFiscalRuntimeMissingError(documentResponse.error)) {
      return {
        status: 'ok',
        invoice,
        document: null,
      }
    }
    throw documentResponse.error
  }

  return {
    status: 'ok',
    invoice,
    document: documentResponse.data || null,
  }
}

export function useSales() {
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dailyRevenue, setDailyRevenue] = useState(0)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const { activeModuleId } = useModuleCtx()
  const { activeTenantId } = useAuthCtx()

  const load = useCallback(async (filters = {}) => {
    if (!activeModuleId) return
    setLoading(true)
    setError(null)
    const tz = getTimezoneOffset()

    try {
      const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        const buildQuery = (selectString) => {
          let query = supabase
            .from('sales')
            .select(selectString)
            .eq('module_id', activeModuleId)
            .order('created_at', { ascending: false })

          query = applyTenantFilter(query, activeTenantId, includeTenant)
          if (filters.status) query = query.eq('status', filters.status)
          if (filters.date) {
            query = query
              .gte('created_at', `${filters.date}T00:00:00${tz}`)
              .lte('created_at', `${filters.date}T23:59:59.999${tz}`)
          }
          if (!filters.date) query = query.limit(100)
          return query
        }

        const selectOptions = {
          includeFulfillment: true,
          includeDeliveryFee: true,
          includeProfiles: true,
          includeClients: true,
        }
        let scopedResponse = await buildQuery(salesSelect(selectOptions))

        if (scopedResponse.error && hasColumnError(scopedResponse.error, 'delivery_fee')) {
          selectOptions.includeDeliveryFee = false
          scopedResponse = await buildQuery(salesSelect(selectOptions))
        }
        if (scopedResponse.error && hasColumnError(scopedResponse.error, 'fulfillment_type')) {
          selectOptions.includeFulfillment = false
          scopedResponse = await buildQuery(salesSelect(selectOptions))
        }
        if (scopedResponse.error && hasColumnError(scopedResponse.error, 'client_id')) {
          selectOptions.includeClients = false
          scopedResponse = await buildQuery(salesSelect(selectOptions))
        }
        if (scopedResponse.error && hasColumnError(scopedResponse.error, 'profile_id')) {
          selectOptions.includeProfiles = false
          scopedResponse = await buildQuery(salesSelect(selectOptions))
        }

        return scopedResponse
      })

      if (response.error) throw response.error
      setSales(mapSalesRows(response.data || []))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeModuleId, activeTenantId])

  const loadMetrics = useCallback(async () => {
    if (!activeModuleId) return null

    const tz = getTimezoneOffset()
    const today = todayISO()
    const firstDay = `${today.substring(0, 8)}01`

    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('sales')
        .select('total_price, created_at')
        .eq('module_id', activeModuleId)
        .eq('status', 'concluido')
        .gte('created_at', `${firstDay}T00:00:00${tz}`)

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    const data = response.data || []
    let dRev = 0
    let mRev = 0

    data.forEach((sale) => {
      const val = parseFloat(sale.total_price) || 0
      mRev += val
      if (sale.created_at >= `${today}T00:00:00${tz}`) dRev += val
    })

    setDailyRevenue(dRev)
    setMonthRevenue(mRev)
    return { faturamento_hoje: dRev, faturamento_mes: mRev }
  }, [activeModuleId, activeTenantId])

  const createSaleLegacy = useCallback(async (saleData, cartItems) => {
    if (!cartItems?.length) throw new Error('Carrinho vazio')
    if (!activeModuleId) throw new Error('Modulo nao identificado')
    assertActiveTenant(activeTenantId, 'salvar a venda')

    const subtotal = cartItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
    const discount = Number(saleData.discount || 0)
    const totalPrice = Math.max(0, subtotal - discount)

    const apiSaleData = { ...saleData }
    if (apiSaleData.pet_id) {
      apiSaleData.client_id = apiSaleData.pet_id
      delete apiSaleData.pet_id
    }
    if (apiSaleData.employee_id) {
      apiSaleData.profile_id = apiSaleData.employee_id
      delete apiSaleData.employee_id
    }

    if (apiSaleData.client_id) {
      const clientResponse = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        let query = supabase
          .from('clients')
          .select('name, phone')
          .eq('id', apiSaleData.client_id)
          .eq('module_id', activeModuleId)
          .eq('active', true)
          .maybeSingle()

        query = applyTenantFilter(query, activeTenantId, includeTenant)
        return query
      })

      const clientData = clientResponse.data
      if (clientData) {
        apiSaleData.customer_name = apiSaleData.customer_name || clientData.name || 'Balcao'
        apiSaleData.customer_phone = apiSaleData.customer_phone || clientData.phone || null
      }
    }

    const basePayload = {
      ...apiSaleData,
      subtotal,
      total_price: totalPrice,
      status: 'concluido',
      source: apiSaleData.source || 'pdv',
      module_id: activeModuleId,
    }

    const insertSale = (payload, selectOptions) => runWithTenantFallback(activeTenantId, async (includeTenant) => {
      const finalPayload = buildTenantPayload(payload, activeTenantId, includeTenant)
      return supabase
        .from('sales')
        .insert(finalPayload)
        .select(insertSaleSelect(selectOptions))
        .single()
    })

    let salePayload = { ...basePayload }
    let saleResponse = await insertSale(salePayload, { includeClient: true, includeFulfillment: true })

    if (saleResponse.error && hasColumnError(saleResponse.error, 'fulfillment_type')) {
      salePayload = {
        ...salePayload,
        notes: [
          salePayload.notes,
          salePayload.source === 'whatsapp' && salePayload.fulfillment_type
            ? `Fluxo operacional: ${salePayload.fulfillment_type}`
            : null,
        ].filter(Boolean).join(' | ') || null,
      }
      delete salePayload.fulfillment_type
      saleResponse = await insertSale(salePayload, { includeClient: true, includeFulfillment: false })
    }

    if (saleResponse.error && hasColumnError(saleResponse.error, 'profile_id')) {
      salePayload = {
        ...salePayload,
        notes: [
          salePayload.notes,
          apiSaleData.profile_id ? `Responsavel: ${apiSaleData.profile_id}` : null,
        ].filter(Boolean).join(' | ') || null,
      }
      delete salePayload.profile_id
      saleResponse = await insertSale(salePayload, { includeClient: true, includeFulfillment: false })
    }

    if (saleResponse.error && hasColumnError(saleResponse.error, 'client_id')) {
      salePayload = {
        ...salePayload,
        notes: [
          salePayload.notes,
          apiSaleData.client_id ? `Cliente legado mapeado: ${apiSaleData.client_id}` : null,
        ].filter(Boolean).join(' | ') || null,
      }
      delete salePayload.client_id
      saleResponse = await insertSale(salePayload, { includeClient: false, includeFulfillment: false })
    }

    if (saleResponse.error) throw saleResponse.error
    const sale = saleResponse.data

    const itemsPayload = cartItems.map((item) => ({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.unit_price * item.quantity,
      upsell: item.upsell || false,
    }))

    const itemsResponse = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      const scopedItems = itemsPayload.map((item) => buildTenantPayload(item, activeTenantId, includeTenant))
      return supabase.from('sale_items').insert(scopedItems)
    })

    if (itemsResponse.error) throw itemsResponse.error

    const paymentSplits = Array.isArray(apiSaleData.payment_splits)
      ? apiSaleData.payment_splits
        .filter((item) => Number(item?.amount || 0) > 0)
        .map((item, index) => ({
          sale_id: sale.id,
          module_id: activeModuleId,
          payment_method: item.method || 'outros',
          amount: Number(item.amount || 0),
          position: index + 1,
        }))
      : []

    if (paymentSplits.length > 0) {
      const splitResponse = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
        const scopedSplits = paymentSplits.map((item) => buildTenantPayload(item, activeTenantId, includeTenant))
        return supabase.from('sale_payment_splits').insert(scopedSplits)
      })

      if (splitResponse.error && !isSalePaymentSplitSchemaError(splitResponse.error)) {
        throw splitResponse.error
      }
    }

    try {
      await syncSaleToChatTimeline(activeModuleId, activeTenantId, sale, cartItems)
    } catch (chatSyncError) {
      console.warn('Falha ao sincronizar venda com o chat:', chatSyncError)
    }

    await load({ date: todayISO() })
    await loadMetrics()
    return sale
  }, [activeModuleId, activeTenantId, load, loadMetrics])

  const createSale = useCallback(async (saleData, cartItems) => {
    if (!cartItems?.length) throw new Error('Carrinho vazio')
    if (!activeModuleId) throw new Error('Modulo nao identificado')
    assertActiveTenant(activeTenantId, 'salvar a venda')

    const result = await checkoutPetshop({
      tenantId: activeTenantId,
      moduleId: activeModuleId,
      clientId: saleData.client_id || saleData.pet_id || null,
      customerName: saleData.customer_name || 'Balcao',
      customerPhone: saleData.customer_phone || null,
      paymentMethod: saleData.payment_method,
      paymentSplits: saleData.payment_splits || [],
      discount: Number(saleData.discount || 0),
      source: saleData.source || 'pdv',
      fulfillmentType: saleData.fulfillment_type || 'balcao',
      notes: saleData.notes || null,
      idempotencyKey: saleData.idempotency_key || crypto.randomUUID(),
      items: cartItems.map((item) => ({
        productId: item.product_id,
        quantity: Number(item.quantity || 0),
        upsell: item.upsell === true,
      })),
    })

    const sale = { ...result.sale, fiscal_queue: result.fiscal }
    try {
      await syncSaleToChatTimeline(activeModuleId, activeTenantId, sale, cartItems)
    } catch (chatSyncError) {
      console.warn('Falha ao sincronizar venda com o chat:', chatSyncError)
    }

    await load({ date: todayISO() })
    await loadMetrics()
    return sale
  }, [activeModuleId, activeTenantId, load, loadMetrics])

  const issueSaleFiscal = useCallback(async (saleId) => {
    if (!saleId) throw new Error('Venda nao informada para emissao fiscal.')
    assertActiveTenant(activeTenantId, 'emitir a nota')
    const result = await syncFiscalForSale(activeModuleId, activeTenantId, { id: saleId })
    return result
  }, [activeModuleId, activeTenantId])

  const getDailyStats = useCallback(async (date = todayISO()) => {
    if (!activeModuleId) return { revenue: 0, count: 0, upsells: 0, salesMix: [] }
    const tz = getTimezoneOffset()

    const response = await runWithTenantFallback(activeTenantId, async (includeTenant) => {
      let query = supabase
        .from('sales')
        .select('total_price, status, source, sale_items(upsell, products(category, name))')
        .eq('module_id', activeModuleId)
        .gte('created_at', `${date}T00:00:00${tz}`)
        .lte('created_at', `${date}T23:59:59.999${tz}`)
        .eq('status', 'concluido')

      query = applyTenantFilter(query, activeTenantId, includeTenant)
      return query
    })

    const data = response.data || []
    const total = data.reduce((acc, row) => acc + (parseFloat(row.total_price) || 0), 0)
    const upsells = data.flatMap((row) => row.sale_items || []).filter((item) => item?.upsell).length
    const mixMap = new Map()

    const upsertMix = (label, amount) => {
      const safeLabel = label || 'Outros'
      mixMap.set(safeLabel, (mixMap.get(safeLabel) || 0) + (parseFloat(amount) || 0))
    }

    data.forEach((row) => {
      const value = parseFloat(row.total_price) || 0
      const source = String(row.source || '').trim().toLowerCase()

      if (source === 'whatsapp') {
        upsertMix('WhatsApp', value)
        return
      }

      const categories = (row.sale_items || [])
        .map((item) => item?.products?.category)
        .filter(Boolean)
        .map((category) => String(category).trim().toLowerCase())

      if (categories.some((category) => category.includes('banho') || category.includes('tosa') || category.includes('groom'))) {
        upsertMix('Banho/Tosa', value)
      } else if (categories.some((category) => category.includes('veterin'))) {
        upsertMix('Veterinaria', value)
      } else if (source === 'pdv' || !source) {
        upsertMix('PDV', value)
      } else {
        upsertMix(source.toUpperCase(), value)
      }
    })

    const salesMix = Array.from(mixMap.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    return { revenue: total, count: data.length, upsells, salesMix }
  }, [activeModuleId, activeTenantId])

  return {
    sales,
    loading,
    error,
    dailyRevenue,
    monthRevenue,
    load,
    loadMetrics,
    createSale,
    issueSaleFiscal,
    getDailyStats,
    fmtCurrency,
  }
}
