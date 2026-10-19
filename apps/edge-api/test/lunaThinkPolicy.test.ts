import {thinkOperationIdSchema,cartSnapshotSchema} from '../src/luna/thinkCart'
import {describe,it,expect} from 'vitest'
import {batchDue,ratingFromMessage,withdrawalMessage} from '../src/luna/thinkPolicy'
import {validateThinkReply,zonedIsoTime} from '../src/luna/thinkPresentation'
import {explicitConfirmation} from '../src/luna/commitProposal'
import {compactThinkFacts} from '../src/luna/thinkFacts'
import {supportedClassificationChanges,authorizedCatalogRemoval} from '../src/luna/thinkCatalog/validation'

describe('Think: conversa e provas comerciais',()=>{
 it('IDs de rascunho seguem o contrato operacional antes de chamar Actions',()=>{
  for(const id of ['cart-1','banho_mel'])expect(thinkOperationIdSchema.safeParse(id).success).toBe(true)
  for(const id of ['pedido-ração','__proto__','constructor','prototype','a.b'])expect(thinkOperationIdSchema.safeParse(id).success).toBe(false)
  expect(cartSnapshotSchema.safeParse({items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'counter'}).success).toBe(true)
 })
 it('textura não autoriza forma úmida e busca vazia não autoriza remover preferências',()=>{
  const checked=supportedClassificationChanges({},{foodForm:'wet',productType:'treat',species:'dog'},'Queria petiscos molinhos para cachorro.')
  expect(checked.changes).toEqual({productType:'treat',species:'dog'})
  expect(checked.discarded.foodForm).toContain('textura')
  expect(supportedClassificationChanges({},{animalSize:'medium'},'Meu cachorro pesa 12 kg.').changes).toEqual({})
  expect(supportedClassificationChanges({},{animalSize:'medium'},'É de porte médio.').changes).toEqual({animalSize:'medium'})
  expect(supportedClassificationChanges({},{foodForm:'wet'},'Quero alimento úmido.').changes).toEqual({foodForm:'wet'})
  expect(authorizedCatalogRemoval({brand:'Quatree',packageWeightGrams:15000},['brand','packageWeightGrams'],'Pode mostrar outras marcas.')).toEqual({allowed:['brand'],blocked:['packageWeightGrams']})
  expect(authorizedCatalogRemoval({brand:'Quatree'},['brand'],'Não encontrou?')).toEqual({allowed:[],blocked:['brand']})
  expect(authorizedCatalogRemoval({brand:'Quatree'},['brand'],'Não pode remover a marca.')).toEqual({allowed:[],blocked:['brand']})
 })
 it('compacta somente a projeção de fatos, preservando zero, falso e atributos distintos',()=>{
  const source={price_cents:0,stock_confirmed:false,ingredients:null,products:[],name:'Produto',attributes_json:'{"name":"Produto","texture":"macia","height_cm":12}'}
  expect(compactThinkFacts(source)).toEqual({price_cents:0,stock_confirmed:false,products:[],name:'Produto',attributes:{texture:'macia',height_cm:12}})
  expect(source.ingredients).toBeNull()
  expect(compactThinkFacts({attributes_json:'invalid'})).toEqual({attributes_json:'invalid'})
 })
 it('expõe saldo em unidades e mantém orçamento separado do preço do produto',()=>{
  expect(compactThinkFacts({available_milliunits:20000,stock_confirmed:true})).toEqual({available_quantity:20,stock_confirmed:true})
  expect(compactThinkFacts({available_milliunits:0})).toEqual({available_quantity:0})
  const facts=[{name:'search_products',result:{preferences:{maxPriceCents:13000},products:[{price_cents:9000,available_quantity:20}]}}]
  expect(validateThinkReply('Opções até R$ 130,00: Ração A por R$ 90,00. Temos estoque.',facts).ok).toBe(true)
  expect(validateThinkReply('A Ração A custa R$ 130,00.',facts).ok).toBe(false)
 })
 it('fornece horário com offset da loja preservando exatamente o instante',()=>{
  for(const [utc,local] of [['2026-10-17T17:00:00Z','2026-10-17T14:00:00-03:00'],['2026-10-17T01:00:00Z','2026-10-16T22:00:00-03:00']]){
   expect(zonedIsoTime(utc,'America/Sao_Paulo')).toBe(local)
   expect(Date.parse(zonedIsoTime(utc,'America/Sao_Paulo'))).toBe(Date.parse(utc))
  }
  expect(zonedIsoTime('2026-10-17T17:00:00Z','UTC')).toBe('2026-10-17T17:00:00Z')
 })
 it('compara horário local e intervalo do serviço sem confundir duração com vaga',()=>{
  const facts=[{name:'get_available_slots',result:{ok:true,data:{slots:['2026-10-17T17:00:00.000Z'],timezone:'America/Sao_Paulo',duration_minutes:60}}}]
  expect(validateThinkReply('Tenho às 14h.',facts).ok).toBe(true)
  expect(validateThinkReply('Das 14h às 15h, duração de 1h.',facts).ok).toBe(true)
  expect(validateThinkReply('Às 14h, dura 1 hora.',facts).ok).toBe(true)
  expect(validateThinkReply('Tenho às 15h.',facts).ok).toBe(false)
  expect(validateThinkReply('Das 14h às 16h.',facts).ok).toBe(false)
  expect(validateThinkReply('Não há vaga às 14h. A única opção disponível é às 17h.',facts).ok).toBe(false)
  expect(validateThinkReply('Às 15h está ocupado. Tenho às 14h.',facts).ok).toBe(true)
  expect(validateThinkReply('Não há vaga às 15h. Tenho às 14h.',facts).ok).toBe(true)
 })
 it('permite indisponibilidade consultada sem liberar uma afirmação positiva na mesma resposta',()=>{
  const empty=[{name:'get_available_slots',result:{ok:true,data:{slots:[],timezone:'America/Sao_Paulo'}}}]
  expect(validateThinkReply('Não há horário disponível para 21/10 às 14h. Outro horário?',empty).ok).toBe(true)
  expect(validateThinkReply('Não há horário disponível às 14h. Tenho vaga às 15h.',empty).ok).toBe(false)
  expect(validateThinkReply('Tenho horário disponível às 14h.',empty).ok).toBe(false)
  expect(validateThinkReply('Não há horário disponível às 14h.',[]).ok).toBe(false)
 })
 it('aguarda dez segundos após a última mensagem, inclusive em sequências longas',()=>{expect(batchDue(1000,1200)).toBe(11200);expect(batchDue(1000,5900)).toBe(15900);expect(batchDue(1000,30000)).toBe(40000)})
 it('nota não se confunde com quantidades ou alternativas',()=>{expect(ratingFromMessage('5 estrelas')).toBe(5);expect(ratingFromMessage('5 sachês')).toBeNull();expect(ratingFromMessage('0')).toBeNull();expect(ratingFromMessage('1 ou 5')).toBeNull()})
 it('desistência não é uma correção de serviço',()=>{expect(withdrawalMessage('deixa pra lá')).toBe(true);expect(withdrawalMessage('não é tosa, só banho')).toBe(false)})
 it('aceita linguagem explícita, rejeitando ressalvas, dúvida e negação',()=>{for(const text of ['sim pix','pode ser','pode fechar sim','confirmo sim'])expect(explicitConfirmation(text,'product_order_create')).toBe(true);for(const text of ['sim mas troca para 2','não confirmo','sim?','pode ser amanhã?','sim, entrega em outro lugar'])expect(explicitConfirmation(text,'product_order_create')).toBe(false)})
 it('repetir a modalidade só confirma quando corresponde à proposta',()=>{
  expect(explicitConfirmation('Confirmo esse pedido para retirada.','product_order_create','counter')).toBe(true)
  expect(explicitConfirmation('Confirmo esse pedido para entrega.','product_order_create','counter')).toBe(false)
  expect(explicitConfirmation('Confirmo esse pedido para retirada, mas troca para dois.','product_order_create','counter')).toBe(false)
  expect(explicitConfirmation('Confirmo esse pedido para retirada.','')).toBe(false)
  expect(explicitConfirmation('Confirmo este agendamento.','appointment_create')).toBe(true)
 })
 it('valores e disponibilidade precisam de ferramenta, e pagamento não é integrado',()=>{
  const facts=[{name:'search_products',result:{ok:true,data:{products:[{price_cents:12990,available_milliunits:1000}]}}}]
  expect(validateThinkReply('A Gourmet fica R$ 129,90.',facts).ok).toBe(true)
  expect(validateThinkReply('Fica R$ 99,90.',facts).ok).toBe(false)
  expect(validateThinkReply('Pagamento confirmado!',facts).ok).toBe(false)
  expect(validateThinkReply('Entrega amanhã.',facts).ok).toBe(false)
  expect(validateThinkReply('Temos em estoque.',[]).ok).toBe(false)
  expect(validateThinkReply('Quer retirar ou entregar?',facts).ok).toBe(true)
 })
})
