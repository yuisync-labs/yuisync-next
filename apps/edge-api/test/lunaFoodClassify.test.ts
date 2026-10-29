import { describe, expect, it } from 'vitest'
import { brandCandidates, classifyFood, ensureCatalogProfiled, ensureFoodClassified, profileFor } from '../src/luna/thinkCatalog/autoClassify'

const names = ['QUATREE SUPREME CAES ADULTOS RACA PEQUENA 15 KG', 'GRANEL QUATREE GOURMET CAES FILHOTES', 'QUATREE SUPREME GATOS CASTRADO SÊNIOR +7 10,1 KG', 'BIFINHOS SABOR CARNE SNACKS QUATREE CARNE -', 'BIONATURAL RAC PEQ CORDEIRO 15 KG', 'BIONATURAL JUNIOR RAÇAS PEQUENAS FRANGO 15 KG', 'BIONATURAL MED/GRANDE FRANGO 20 KG', 'PREMIER RAÇAS ESPECIFICAS SHIH TZU SALMÃO']
const brands = brandCandidates(names)
const food = (name: string, extra: { category?: string; species_target?: string | null; unit?: string | null } = {}) => classifyFood({ name, category: 'Ração', species_target: null, unit: 'UN', ...extra }, brands)

describe('food classification from the product name', () => {
  it('reads brand, species, size, life stage and package weight', () => {
    expect(food(names[0])).toMatchObject({ product_type: 'feed', brand_code: 'quatree', species: ['dog'], sizes: ['small'], life_stage: 'adult', sale_form: 'packaged', package_weight_grams: 15000, food_form: 'dry' })
    expect(food(names[2])).toMatchObject({ species: ['cat'], life_stage: 'senior', package_weight_grams: 10100 })
    expect(food(names[6])).toMatchObject({ brand_code: 'bionatural', sizes: ['medium', 'large'] })
  })
  it('treats bulk food as sold by weight and finds the brand after generic words', () => {
    expect(food(names[1], { unit: 'KG', species_target: 'dog' })).toMatchObject({ sale_form: 'bulk', package_weight_grams: null, life_stage: 'puppy', brand_code: 'quatree' })
    expect(food(names[3], { category: 'Petisco' })).toMatchObject({ product_type: 'treat', brand_code: 'quatree', food_form: null })
  })
  it('lets the name win over a wrong species column and skips non-food', () => {
    expect(food('QUATREE SUPREME GATOS ADULTOS 1KG', { species_target: 'all' })?.species).toEqual(['cat'])
    expect(food(names[7], { species_target: 'dog' })?.species).toEqual(['dog'])
    expect(food('COLEIRA AZUL', { category: 'Acessório' })).toBeNull()
  })
})

describe('non-food profile from category and name', () => {
  const profile = (name: string, category: string, species_target: string | null = null) => profileFor({ name, category, species_target, unit: 'UN' })
  it('finds the subtype, species and package facts', () => {
    expect(profile('AREIA GRANULADO GATISSIMO S/PERFUME 4 KG', 'Higiene')).toMatchObject({ product_type: 'hygiene', subtype: 'litter', net_weight_grams: 4000 })
    expect(profile('AFASTA DOG SPRAY PROCANINE 500 ML', 'Higiene')).toMatchObject({ species: ['dog'], net_volume_ml: 500 })
    expect(profile('ARRANHADOR MINI POSTE CAT', 'Acessório')).toMatchObject({ subtype: 'scratcher', species: ['cat'] })
    expect(profile('ACESSORIOS PARA GATO C/11 UNID JAMBO', 'Brinquedo')).toMatchObject({ subtype: 'toy_unspecified', pack_count: 11 })
    expect(profile('ANTITOXICO DUPRAT ORAL 20ML', 'Medicamento')).toMatchObject({ subtype: 'medicine_unspecified', requires_professional_guidance: 1 })
    expect(profile('RACAO X', 'Serviço')).toBeNull()
  })
})

describe('classification writes a whole catalog in a few statements', () => {
  it('stores attributes and profiles for hundreds of products in one batch each', async () => {
    const { env } = await import('cloudflare:workers')
    const db = env.DB!, tenant = 'auto-classify-bulk', now = Date.now()
    await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?,?,'Fixture','active',?,?)").bind(tenant, tenant, now, now).run()
    const rows = Array.from({ length: 200 }, (_, i) => [i % 2 ? 'Ração' : 'Higiene', i % 2 ? `QUATREE GOURMET CAES ADULTOS RACAS PEQUENAS ${i} 15KG` : `AREIA GRANULADO PARA GATOS ${i} 4 KG`])
    await db.batch(rows.map(([category, name], i) => db.prepare("INSERT INTO catalog_products(tenant_id,module_id,id,name,category,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,?,?,?,?)").bind(tenant, 'p' + i, name, category, now, now)))
    let batches = 0
    const counted = new Proxy(db, { get: (t, k) => k === 'batch' ? (s: D1PreparedStatement[]) => { batches += s.length; return t.batch(s) } : (t as any)[k].bind(t) })
    expect(await ensureFoodClassified(counted, tenant)).toBe(100)
    expect(await ensureCatalogProfiled(counted, tenant)).toBe(100)
    expect(batches).toBeLessThanOrEqual(8)
    const one = await db.prepare("SELECT a.brand_code,a.package_weight_grams,a.revision,(SELECT group_concat(species) FROM catalog_product_species s WHERE s.tenant_id=a.tenant_id AND s.product_id=a.product_id) species,(SELECT group_concat(animal_size) FROM catalog_product_sizes z WHERE z.tenant_id=a.tenant_id AND z.product_id=a.product_id) sizes FROM catalog_product_attributes a WHERE a.tenant_id=? AND a.product_id='p1'").bind(tenant).first()
    expect(one).toMatchObject({ brand_code: 'quatree', package_weight_grams: 15000, revision: 'auto:' + now, species: 'dog', sizes: 'small' })
    const litter = await db.prepare("SELECT x.subtype,x.net_weight_grams,(SELECT group_concat(species) FROM catalog_product_profile_species s WHERE s.tenant_id=x.tenant_id AND s.product_id=x.product_id) species FROM catalog_product_profiles x WHERE x.tenant_id=? AND x.product_id='p0'").bind(tenant).first()
    expect(litter).toMatchObject({ subtype: 'litter', net_weight_grams: 4000, species: 'cat' })
    expect(await db.prepare("SELECT count(*) n FROM catalog_product_attributes WHERE tenant_id=?").bind(tenant).first('n')).toBe(100)
    expect(await ensureFoodClassified(counted, tenant)).toBe(0)
  })
})
