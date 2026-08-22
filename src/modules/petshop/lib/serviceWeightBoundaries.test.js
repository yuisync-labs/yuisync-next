import { describe, expect, it } from 'vitest'
import {
  appointmentServiceEligibility,
  serviceFitsPetSpecies,
  serviceFitsPetWeight,
  serviceWeightRange,
} from './appointmentServices.js'

const SMALL_DOG = {
  code: 'banho-small',
  name: 'Banho pequeno',
  species_target: 'dog',
  min_weight_kg: 0,
  max_weight_kg: 10.099,
}

const MEDIUM_DOG = {
  code: 'banho-medium',
  name: 'Banho medio',
  species_target: 'dog',
  min_weight_kg: 10.1,
  max_weight_kg: 22.1,
}

const LARGE_DOG = {
  code: 'banho-large',
  name: 'Banho grande',
  species_target: 'dog',
  min_weight_kg: 22.101,
  max_weight_kg: 40,
}

describe('service weight boundary regression matrix', () => {
  it('keeps 10.099 kg in the small range without rounding it to 10.100', () => {
    expect(serviceFitsPetWeight(SMALL_DOG, 10.099)).toBe(true)
    expect(serviceFitsPetWeight(MEDIUM_DOG, 10.099)).toBe(false)
  })

  it('moves exactly 10.100 kg to the medium range', () => {
    expect(serviceFitsPetWeight(SMALL_DOG, 10.1)).toBe(false)
    expect(serviceFitsPetWeight(MEDIUM_DOG, 10.1)).toBe(true)
  })

  it('keeps exactly 22.100 kg in the medium range', () => {
    expect(serviceFitsPetWeight(MEDIUM_DOG, 22.1)).toBe(true)
    expect(serviceFitsPetWeight(LARGE_DOG, 22.1)).toBe(false)
  })

  it('moves exactly 22.101 kg to the large range', () => {
    expect(serviceFitsPetWeight(MEDIUM_DOG, 22.101)).toBe(false)
    expect(serviceFitsPetWeight(LARGE_DOG, 22.101)).toBe(true)
  })

  it('accepts decimal strings with comma without losing three-decimal precision', () => {
    expect(serviceFitsPetWeight(SMALL_DOG, '10,099')).toBe(true)
    expect(serviceFitsPetWeight(MEDIUM_DOG, '10,100')).toBe(true)
    expect(serviceFitsPetWeight(LARGE_DOG, '22,101')).toBe(true)
  })

  it('gives explicitly configured range priority over conflicting text inference', () => {
    const configured = {
      name: 'Banho pequeno ate 10 kg',
      min_weight_kg: 10.1,
      max_weight_kg: 22.1,
    }
    expect(serviceWeightRange(configured)).toMatchObject({ min: 10.1, max: 22.1, source: 'configured' })
    expect(serviceFitsPetWeight(configured, 10.099)).toBe(false)
    expect(serviceFitsPetWeight(configured, 10.1)).toBe(true)
  })

  it('does not invent a weight incompatibility when pet weight is absent', () => {
    expect(serviceFitsPetWeight(SMALL_DOG, null)).toBe(true)
    expect(serviceFitsPetWeight(MEDIUM_DOG, '')).toBe(true)
  })
})

describe('service species boundary regression matrix', () => {
  it('allows dogs only on dog-targeted services', () => {
    expect(serviceFitsPetSpecies(SMALL_DOG, 'dog')).toBe(true)
    expect(serviceFitsPetSpecies(SMALL_DOG, 'cat')).toBe(false)
  })

  it('allows cats only on cat-targeted services', () => {
    const catService = { name: 'Banho gato', species_target: 'cat' }
    expect(serviceFitsPetSpecies(catService, 'cat')).toBe(true)
    expect(serviceFitsPetSpecies(catService, 'dog')).toBe(false)
  })

  it('combines species and exact weight in the appointment eligibility result', () => {
    expect(appointmentServiceEligibility(SMALL_DOG, { species: 'dog', weight_kg: 10.099 })).toMatchObject({
      eligible: true,
      speciesEligible: true,
      weightEligible: true,
    })

    expect(appointmentServiceEligibility(SMALL_DOG, { species: 'dog', weight_kg: 10.1 })).toMatchObject({
      eligible: false,
      speciesEligible: true,
      weightEligible: false,
    })

    expect(appointmentServiceEligibility(SMALL_DOG, { species: 'cat', weight_kg: 10.099 })).toMatchObject({
      eligible: false,
      speciesEligible: false,
      weightEligible: true,
    })
  })
})
