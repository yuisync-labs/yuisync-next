const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export async function adjustInventoryCommand({
  tenantId,
  moduleId = 'petshop',
  productId,
  delta,
  operationKey = crypto.randomUUID(),
  movementType = 'adjustment',
  reason = null,
  referenceType = null,
  referenceId = null,
  unitCostCents = null,
}) {
  const response = await fetch(`${API_BASE}/app/inventory/adjust`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
    },
    body: JSON.stringify({
      product_id: productId,
      delta,
      operation_key: operationKey,
      movement_type: movementType,
      reason,
      reference_type: referenceType,
      reference_id: referenceId,
      unit_cost_cents: unitCostCents,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || payload.code || 'Não foi possível ajustar o estoque.')
    error.code = payload.code || ''
    error.status = response.status
    throw error
  }
  return payload.adjustment
}
