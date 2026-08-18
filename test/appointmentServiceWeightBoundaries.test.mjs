import { describe, expect, it } from 'vitest'

import { serviceFitsPetWeight } from '../src/modules/petshop/lib/appointmentServices.js'

const SMALL = { min_weight_kg: 0, max_weight_kg: 10.099 }
const MEDIUM = { min_weight_kg: 10.1, max_weight_kg: 22.1 }
const LARGE = { min_weight_kg: 22.101, max_weight_kg: 40 }

describe('canonical petshop service weight boundaries', () => {
  it.each([
    [0, true, false, false],
    [10.099, true, false, false],
    [10.1, false, true, false],
    [22.1, false, true, false],
    [22.101, false, false, true],
    [40, false, false, true],
  ])('classifies %s kg without overlap or gap', (weightKg, small, medium, large) => {
    expect(serviceFitsPetWeight(SMALL, weightKg)).toBe(small)
    expect(serviceFitsPetWeight(MEDIUM, weightKg)).toBe(medium)
    expect(serviceFitsPetWeight(LARGE, weightKg)).toBe(large)
  })

  it('rejects values immediately across each canonical boundary', () => {
    expect(serviceFitsPetWeight(SMALL, 10.1)).toBe(false)
    expect(serviceFitsPetWeight(MEDIUM, 10.099)).toBe(false)
    expect(serviceFitsPetWeight(MEDIUM, 22.101)).toBe(false)
    expect(serviceFitsPetWeight(LARGE, 22.1)).toBe(false)
    expect(serviceFitsPetWeight(LARGE, 40.001)).toBe(false)
  })
})
