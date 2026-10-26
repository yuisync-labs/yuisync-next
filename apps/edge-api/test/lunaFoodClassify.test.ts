import { describe, expect, it } from 'vitest'
import { brandCandidates, classifyFood } from '../src/luna/thinkCatalog/autoClassify'

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
