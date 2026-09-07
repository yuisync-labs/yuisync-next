import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const api = fs.readFileSync(path.join(root, 'apps/edge-api/src/appSettingsApi.ts'), 'utf8')
const compat = fs.readFileSync(path.join(root, 'apps/edge-api/src/compatApi.ts'), 'utf8')
const auth = fs.readFileSync(path.join(root, 'src/context/AuthContext.jsx'), 'utf8')
const sales = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/VendasPage.jsx'), 'utf8')
const orders = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/OrdensEntregaPage.jsx'), 'utf8')
const team = fs.readFileSync(path.join(root, 'src/modules/petshop/pages/EquipePage.jsx'), 'utf8')

describe('tenant receipt settings contract', () => {
  it('allows exactly the migrated company/receipt fields through the native patch', () => {
    for (const field of ['business_name','business_address','business_phone','business_email','business_tax_id','logo_url','receipt_format','receipt_footer']) {
      expect(api).toContain(`'${field}'`)
    }
    expect(api).toContain("if (!canAdminModule(scope.membership, scope.moduleId)) return json({ code: 'FORBIDDEN' }, 403)")
    expect(api).toContain("raw !== '58' && raw !== '80' && raw !== 'a4'")
    expect(api).toContain('const extensions = parseExtensions(extensionRow)')
  })

  it('blocks legacy compat from writing migrated settings and clears branding on tenant change', () => {
    expect(compat).toContain('NATIVE_COMPANY_SETTING_FIELDS')
    expect(compat).toContain('body.payload = stripNativeCompanySettings(body.payload)')
    expect(auth).toContain('setStoreSettings(neutralStoreSettings(tenantName))')
    expect(auth).toContain('if (activeTenantIdRef.current !== requestedTenantId) return')
  })

  it('routes Vendas, Ordens and Comissoes to the shared receipt layer', () => {
    expect(sales).toContain('openReceiptPreview({ storeSettings')
    expect(sales).toContain('fmtCurrency(Number(sale.subtotal || 0))')
    expect(sales).not.toContain('sale.total + (sale.discount || 0) - (sale.deliveryFee || 0)')
    expect(orders).toContain('openReceiptPreview({')
    expect(team).toContain("initialFormat: 'a4'")
  })
})
