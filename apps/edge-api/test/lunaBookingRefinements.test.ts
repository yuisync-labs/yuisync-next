import { describe, expect, it } from 'vitest'
import { withPostalAddress } from '../src/luna/postalCode'
import { isTosaService, slotFits } from '../src/luna/schedulePolicy'
import { withoutInternalErrors } from '../src/luna/thinkPresentation'

const at = (h: number) => Date.UTC(2026, 9, 30, h + 3)
const booked = (h: number, tosa = false) => ({ start: at(h), end: at(h) + 3600000, tosa })

describe('slot capacity by service', () => {
  const policy = { capacity: 4, tosaLoad: 3 }
  it('takes up to four baths at the same time', () => {
    expect(slotFits([booked(8), booked(8), booked(8)], at(8), at(9), false, policy)).toBe(true)
    expect(slotFits([booked(8), booked(8), booked(8), booked(8)], at(8), at(9), false, policy)).toBe(false)
  })
  it('a tosa leaves room for one bath only', () => {
    expect(slotFits([booked(8, true)], at(8), at(9), false, policy)).toBe(true)
    expect(slotFits([booked(8, true), booked(8)], at(8), at(9), false, policy)).toBe(false)
    expect(slotFits([booked(8), booked(8)], at(8), at(9), true, policy)).toBe(false)
    expect(slotFits([booked(8)], at(8), at(9), true, policy)).toBe(true)
  })
  it('hygienic trims count as baths', () => {
    expect(isTosaService('TOSA MAQUINA 10 KG A 22 KG')).toBe(true)
    expect(isTosaService('Tosa higiênica')).toBe(false)
    expect(isTosaService('BANHO PET PORTE MEDIO')).toBe(false)
  })
})

describe('postal code lookup', () => {
  const viacep = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch
  it('fills street, neighborhood and city the customer did not say', async () => {
    const r = await withPostalAddress({ postal_code: '36880001', address_number: '120' }, viacep({ logradouro: 'Rua Coronel Izalino', bairro: 'Centro', localidade: 'Muriaé' }))
    expect(r.input).toMatchObject({ street: 'Rua Coronel Izalino', neighborhood: 'Centro', city: 'Muriaé', address_number: '120' })
  })
  it('flags a CEP that does not exist and ignores an unreachable service', async () => {
    expect((await withPostalAddress({ postal_code: '99999998' }, viacep({ erro: true }))).notFound).toBe(true)
    const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await withPostalAddress({ postal_code: '12345679' }, down)).toEqual({ notFound: false, input: { postal_code: '12345679' } })
  })
})

describe('internal errors stay out of the reply', () => {
  it('drops the failure sentence and keeps the answer', () => {
    const reply = 'Parece que houve um problema para consultar os horários disponíveis para sexta-feira. Vou tentar novamente para garantir.\nPara sexta-feira temos 15:00 livre. Qual horário você prefere?'
    expect(withoutInternalErrors(reply)).toBe('Para sexta-feira temos 15:00 livre. Qual horário você prefere?')
    expect(withoutInternalErrors('Tudo certo! Qual horário?')).toBe('Tudo certo! Qual horário?')
  })
})
