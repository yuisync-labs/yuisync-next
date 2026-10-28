import { describe, expect, it } from 'vitest'
import { canonicalBreed } from '../src/luna/breeds'
import { explicitConfirmation } from '../src/luna/commitProposal'
import { naturalConfirmation } from '../src/luna/confirmationLanguage'
import { promisesHandoff } from '../src/luna/thinkAgent'
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

describe('a bare day asks for the time', () => {
  it('only a time, a period or a list request shows slots', async () => {
    const { timeSaid } = await import('../src/luna/bookingSteps')
    for (const text of ['na sexta às 10', 'sexta 15h', 'quarta de tarde', 'quais horários tem?', 'amanhã 9:30']) expect(timeSaid(text), text).toBe(true)
    for (const text of ['na sexta', 'amanhã', 'eu quero pra sexta feira agora', 'dia 30']) expect(timeSaid(text), text).toBe(false)
  })
})

it('phoneVariants finds the stored number from the WhatsApp spelling', async () => {
  const { phoneVariants } = await import('../src/luna/customerIdentity')
  expect(phoneVariants('5532999998888')).toEqual(expect.arrayContaining(['32999998888', '3299998888', '5532999998888', '+5532999998888']))
  expect(phoneVariants('553299998888')).toEqual(expect.arrayContaining(['32999998888', '3299998888']))
  expect(phoneVariants('32999998888')).toEqual(expect.arrayContaining(['5532999998888', '553299998888']))
  expect(phoneVariants('3233334444')).not.toContain('32933334444')
  expect(phoneVariants('abc')).toEqual([])
})

it('Byanka refinements: courtesy yes, one-leg MotoDog, said weight, duplicates, handoff labels', async () => {
  const { naturalConfirmation } = await import('../src/luna/confirmationLanguage')
  const { oneLegSaid, weightFromSaid } = await import('../src/luna/bookingSteps')
  const { samePerson } = await import('../src/luna/customerIdentity')
  const { handoffReasonLabel } = await import('../src/luna/handoffReasons')
  const payload = { pet_name: 'PANDORA', services: [{ name: 'BANHO PET PORTE PEQUENO' }] }
  for (const yes of ['sim obrigada', 'sim, obrigado!', 'perfeito, pode agendar', 'ok valeu']) expect(naturalConfirmation(yes, 'appointment_create', payload)).toBe(true)
  for (const no of ['sim, mas é buscar e levar', 'sim, mas muda pra 11h', 'obrigada, vou pensar']) expect(naturalConfirmation(no, 'appointment_create', payload)).toBe(false)
  for (const one of ['só buscar', 'somente levar', 'apenas a volta', 'eu levo, vocês buscam', 'sem a volta', 'quero só que vocês busquem, eu vou buscar depois', 'a volta eu mesma pego']) expect(oneLegSaid(one)).toBe(true)
  for (const both of ['pode buscar por favor', 'sim, quero o MotoDog', 'buscar e levar']) expect(oneLegSaid(both)).toBe(false)
  expect(weightFromSaid('ela tem 8kg quero pra sexta')).toBe('8')
  expect(weightFromSaid('pesava 7 kg, agora uns 8,5 quilos')).toBe('8,5')
  expect(weightFromSaid('quero banho as 10')).toBeNull()
  expect(samePerson(['BARBARA BOUSADA DE AZEVEDO', 'Barbara  Bousada de Azevedo'])).toBe(true)
  expect(samePerson(['Barbara', 'Joana'])).toBe(false)
  expect(handoffReasonLabel('RESPONSE_RECONCILIATION_REQUIRED')).toMatch(/^Falha técnica/)
  expect(handoffReasonLabel('Identidade do cliente ambígua.')).toMatch(/^Cadastro duplicado/)
  expect(handoffReasonLabel('Problema na confirmação do agendamento banho Pandora')).toBe('Agendamento ou pedido não concluído: Problema na confirmação do agendamento banho Pandora')
  expect(handoffReasonLabel('Solicitação clínica exige atendimento humano.')).toMatch(/veterinária/)
  expect(handoffReasonLabel('SOME_NEW_CODE')).not.toMatch(/_/)
})

it('drops sentences that leak tool fields to the customer', () => {
  expect(withoutInternalErrors('O valor do campo de transporte deve ser uma string específica. Você quer só a busca?')).toBe('Você quer só a busca?')
})

it('addressKept accepts a short yes to the quoted address and nothing else', async () => {
  const { addressKept } = await import('../src/luna/bookingSteps')
  for (const yes of ['sim', 'Sim, esse mesmo', 'continua', 'isso', 'é esse']) expect(addressKept(yes)).toBe(true)
  for (const no of ['não, mudei', 'agora é Rua B, 40', 'sim, mas agora é outro', 'quero só buscar']) expect(addressKept(no)).toBe(false)
})

describe('today\'s conversations (28/10)', () => {
  it('breed typos become the breed name', () => {
    expect(canonicalBreed('Huskciberiano')).toBe('Husky Siberiano')
    expect(canonicalBreed('shitzu')).toBe('Shih Tzu')
    expect(canonicalBreed('lhasa')).toBe('Lhasa Apso')
    expect(canonicalBreed('sem raça')).toBe('SRD (sem raça definida)')
    expect(canonicalBreed('pequeno')).toBeNull()
  })
  it('a short "s" confirms a registration', () => {
    expect(explicitConfirmation('s', 'pet_registration')).toBe(true)
    expect(naturalConfirmation('sim, obrigado', 'customer_registration', {})).toBe(true)
    expect(naturalConfirmation('sou eu sim', 'customer_registration', {})).toBe(true)
    expect(naturalConfirmation('não, espera', 'customer_registration', {})).toBe(false)
  })
  it('a reply that promises a person is a handoff', () => {
    expect(promisesHandoff('Vou encaminhar para um atendente humano continuar o atendimento, tudo bem?')).toBe(true)
    expect(promisesHandoff('Já estou passando seu atendimento para a equipe.')).toBe(true)
    expect(promisesHandoff('Quer que eu chame um atendente?')).toBe(false)
  })
})

describe('agent battery chat 1 (28/10 night)', () => {
  it('takes "sim, pode cadastrar" as a yes to the registration', () => {
    for (const yes of ['sim, pode cadastrar', 'pode cadastrar', 'sim pode seguir', 'pode salvar meus dados']) expect(naturalConfirmation(yes, 'customer_registration', {})).toBe(true)
    for (const no of ['pode cadastrar depois', 'não, espera']) expect(naturalConfirmation(no, 'customer_registration', {})).toBe(false)
  })
  it('never shows ids or a retry to the customer', () => {
    const reply = 'Seu cadastro está ok, e o horário das 10h da próxima quarta está disponível para o banho do Bob. Só preciso confirmar o pet_id correto para finalizar o agendamento. O pet cadastrado tem ID diferente do que tentei usar. Vou corrigir e já volto.'
    expect(withoutInternalErrors(reply)).toBe('Seu cadastro está ok, e o horário das 10h da próxima quarta está disponível para o banho do Bob.')
  })
})
