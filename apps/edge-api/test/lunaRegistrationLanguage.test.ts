import { describe, expect, it } from 'vitest'
import { registrationIssue } from '../src/luna/registrationLanguage'

const issue = (args: Record<string, unknown>, said: string, newCustomer = true) => registrationIssue(args, said, newCustomer)?.code ?? null

describe('registration only carries names the customer said', () => {
  it('accepts names introduced by the customer', () => {
    expect(issue({ customer_name: 'Ana', pet_name: 'Thor', breed: 'shihtzu' }, 'ola bom dia, gostaria de agendar um banho Meu nome é Ana, meu pet é o Thor um shihtzu')).toBeNull()
    expect(issue({ customer_name: 'Bia', pet_name: 'Lulu', breed: 'spitz' }, 'sou a Bia, a cachorra se chama Lulu, é uma spitz')).toBeNull()
    expect(issue({ customer_id: 'c1', pet_name: 'Mel' }, 'quero cadastrar a Mel, ela é gata', false)).toBeNull()
  })
  it('refuses a breed or size used as the pet name', () => {
    expect(issue({ customer_name: 'Carla', pet_name: 'huskciberiano', breed: 'médio' }, 'sou a Carla queria tosar o meu cachorro huskciberiano, medio, ainda é filhote')).toBe('PET_NAME_IS_BREED')
    expect(issue({ customer_name: 'Rui', pet_name: 'Yorkshire', breed: 'Yorkshire' }, 'Sou o Rui. Quanto custa pra dar banho num Yorkshire? Vocês buscam em casa?')).toBe('PET_NAME_IS_BREED')
    expect(issue({ customer_name: 'Rui', pet_name: 'Shihtzu' }, 'Sou o Rui, ração pro meu shihtzu')).toBe('PET_NAME_IS_BREED')
  })
  it('refuses names the customer never said and sizes used as breed', () => {
    expect(issue({ customer_name: 'Carolina 1', pet_name: 'Rex' }, 'queria tosar o meu cachorro, o nome dele é Rex')).toBe('CUSTOMER_NAME_NOT_SAID')
    expect(issue({ customer_name: 'Cliente', pet_name: 'Rex' }, 'o nome dele é Rex')).toBe('CUSTOMER_NAME_NOT_SAID')
    expect(issue({ customer_name: 'Ana', pet_name: 'Bob' }, 'sou a Ana, quero banho')).toBe('PET_NAME_NOT_SAID')
    expect(issue({ customer_name: 'Ana', pet_name: 'Bob', breed: 'médio' }, 'sou a Ana, quero banho pro Bob, ele é médio')).toBe('BREED_IS_SIZE')
  })
})

describe('registration weight', () => {
  it('keeps only a weight the customer said', () => {
    expect(issue({ customer_name: 'Carolina', pet_name: 'Broly', weight_kg: 15 }, 'Broly, é um husky. não sei o peso exato mas ele tem um porte medio. Sim. Carolina')).toBe('WEIGHT_NOT_SAID')
    expect(issue({ customer_name: 'Ana', pet_name: 'Thor', weight_kg: 8 }, 'Sou a Ana, meu pet é o Thor, ele tem 8kh')).toBeNull()
    expect(issue({ customer_name: 'Ana', pet_name: 'Thor', weight_kg: 10.5 }, 'Sou a Ana, o Thor tem 10,5 kg')).toBeNull()
  })
})
