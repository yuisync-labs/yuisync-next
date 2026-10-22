import {z} from 'zod'

export const thinkOperationIdSchema=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).refine(id=>!['__proto__','constructor','prototype'].includes(id)).describe('ID estável ASCII: letras sem acentos, números, hífen ou sublinhado, por exemplo cart-1 ou banho-mel. Reutilize o ID do rascunho existente.')
export const cartSnapshotSchema=z.object({
  operation_id:thinkOperationIdSchema.optional().describe('Omita para usar o único carrinho ativo ou criar um ID seguro automaticamente. Se informado, somente letras ASCII, números, hífen e sublinhado.'),
  items:z.array(z.object({product_id:z.string().min(1).max(160),quantity:z.number().int().min(1).max(100).describe('Quantidade comprada de embalagens/SKUs, nunca o conteúdo pack_count. Ex.: um Tapete 28 unidades => quantity:1; dois sachês => quantity:2.'),pet_id:z.string().min(1).max(160).optional().describe('Opcional: somente um pet escolhido explicitamente pelo cliente na conversa. Sem escolha de pet, omita; nunca selecione automaticamente pelo cadastro ou pela espécie do produto.')} ).strict()).min(1).max(12),
  fulfillment_type:z.enum(['counter','delivery']).describe('counter=retirada; delivery=entrega. Use a modalidade dita pelo cliente.'),
  delivery_address:z.object({street:z.string().min(1).max(200),number:z.string().min(1).max(40),city:z.string().min(1).max(160),neighborhood:z.string().min(1).max(160),reference:z.string().max(500).optional(),complement:z.string().max(200).optional(),postal_code:z.string().max(40).optional()}).strict().optional(),
  reference:z.string().max(500).optional().describe('Instrução de retirada informada pelo cliente. Omita quando não houver; não use nome ou endereço da loja como referência.'),
}).strict()

export type DraftChange={action:string;item_id?:string;quantity?:number;pet_id?:string;field?:string;value?:string}
export function cartSnapshotChanges(input:z.infer<typeof cartSnapshotSchema>,prior?:{items:{id:string;quantity:number;petId?:string}[];fields:Record<string,string>}){
  const changes:DraftChange[]=[],wanted=new Set(input.items.map(item=>item.product_id))
  if(wanted.size!==input.items.length)return {ok:false as const,code:'OPERATION_ITEM_DUPLICATE'}
  for(const old of prior?.items??[])if(!wanted.has(old.id))changes.push({action:'remove_item',item_id:old.id})
  for(const item of input.items){
    const old=prior?.items.find(row=>row.id===item.product_id)
    if(!old||old.quantity!==item.quantity||(item.pet_id!==undefined&&old.petId!==item.pet_id))changes.push({action:old?'set_quantity':'add_item',item_id:item.product_id,quantity:item.quantity,...(item.pet_id?{pet_id:item.pet_id}:{})})
  }
  if(prior?.fields.fulfillment_type!==input.fulfillment_type)changes.push({action:'set_fulfillment',value:input.fulfillment_type})
  if(input.fulfillment_type==='delivery'&&input.delivery_address){const value=JSON.stringify(input.delivery_address);if(prior?.fields.address!==value)changes.push({action:'set_field',field:'address',value})}
  if(input.reference!==undefined&&prior?.fields.reference!==input.reference)changes.push({action:'set_field',field:'reference',value:input.reference})
  return changes.length>8?{ok:false as const,code:'DRAFT_CHANGE_LIMIT'}:{ok:true as const,changes}
}
