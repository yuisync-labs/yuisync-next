import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const testEnv = env as EdgeEnv & { DB: D1Database }

async function seedTenant(id: string) {
  const now = Date.now()
  await testEnv.DB.prepare(`INSERT INTO tenants (id,slug,name,status,created_at_ms,updated_at_ms) VALUES (?,?,?,'active',?,?)`)
    .bind(id, id, id, now, now).run()
}

async function product(tenantId: string, id: string, barcode: string | null = null) {
  const now = Date.now()
  return testEnv.DB.prepare(`INSERT INTO catalog_products (tenant_id,module_id,id,name,barcode,price_cents,cost_cents,status,created_at_ms,updated_at_ms) VALUES (?,'petshop',?,'Produto',?,1000,500,'active',?,?)`)
    .bind(tenantId, id, barcode, now, now).run()
}

async function service(tenantId: string, id: string, code: string, sourceProductId: string | null = null) {
  const now = Date.now()
  return testEnv.DB.prepare(`INSERT INTO services (tenant_id,module_id,id,code,name,group_type,default_price_cents,default_duration_min,commission_type,commission_basis_points,source_product_id,status,created_at_ms,updated_at_ms) VALUES (?,'petshop',?,?,?,'banho_tosa',5500,60,'percentage',0,?,'active',?,?)`)
    .bind(tenantId, id, code, code, sourceProductId, now, now).run()
}

describe('catalog + services D1 invariants', () => {
  it('preserva produto e serviço como entidades distintas com vínculo explícito', async () => {
    const tenantId = 'tenant-catalog-linked'
    await seedTenant(tenantId)
    await product(tenantId, 'product-1', '7891')
    await expect(service(tenantId, 'service-1', 'banho_p', 'product-1')).resolves.toMatchObject({ success: true })
  })

  it('rejeita serviço apontando para produto de outro tenant', async () => {
    const owner = 'tenant-catalog-owner'
    const other = 'tenant-catalog-other'
    await seedTenant(owner); await seedTenant(other)
    await product(owner, 'product-shared')
    await expect(service(other, 'service-cross', 'cross', 'product-shared')).rejects.toThrow()
  })

  it('rejeita códigos de serviço duplicados dentro do mesmo escopo', async () => {
    const tenantId = 'tenant-service-code'
    await seedTenant(tenantId)
    await service(tenantId, 'service-a', 'banho')
    await expect(service(tenantId, 'service-b', 'banho')).rejects.toThrow()
  })

  it('permite o mesmo código de serviço em tenants diferentes', async () => {
    const a = 'tenant-service-a'; const b = 'tenant-service-b'
    await seedTenant(a); await seedTenant(b)
    await service(a, 'service-a', 'consulta')
    await expect(service(b, 'service-b', 'consulta')).resolves.toMatchObject({ success: true })
  })

  it('rejeita barcode duplicado no mesmo tenant/módulo', async () => {
    const tenantId = 'tenant-product-barcode'
    await seedTenant(tenantId)
    await product(tenantId, 'product-a', '7890001')
    await expect(product(tenantId, 'product-b', '7890001')).rejects.toThrow()
  })

  it('não permite dois serviços apontando para o mesmo produto source', async () => {
    const tenantId = 'tenant-service-source'
    await seedTenant(tenantId)
    await product(tenantId, 'product-service')
    await service(tenantId, 'service-a', 'catalog_a', 'product-service')
    await expect(service(tenantId, 'service-b', 'catalog_b', 'product-service')).rejects.toThrow()
  })
})