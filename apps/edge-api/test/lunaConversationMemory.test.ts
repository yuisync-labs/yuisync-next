import { describe, expect, it } from 'vitest'
import { createDesignedHarness } from './fixtures/luna/designedRuntimeHarness'
import { loadConversationMemory, resolveContextReference } from '../src/luna/conversationalMemory'

describe('accepted operational memory, real Worker/D1',()=>{
 it('preserves parallel option kinds and resolves other from the current draft, not text regex',async()=>{
  const h=await createDesignedHarness(8,'-memory'),c=h.command,d=h.draft
  const allowed=['search_products','get_customer_context','update_operation_draft','search_services']
  try{
   await h.turn(1,'Mostre as rações.',[[c('search_products',{query:'Ração'})]],allowed,[],['call-1-1-0:product.1','call-1-1-0:product.0'],'choice')
   await h.turn(2,'Essa primeira, e mostre os banhos.',[[d('cart','cart','add_item',{itemId:'racao-b',quantity:1}),c('search_services',{query:'banho'})]],allowed,[],['call-2-1-1:service.0'])
   const context={...h.ctx,sourceMessageId:'in-2'}
   const memory=await loadConversationMemory(h.db,context)
   expect(memory.options.filter(o=>o.kind==='product').map(o=>o.id)).toEqual(['racao-b','racao-a'])
   expect(memory.options.some(o=>o.kind==='service')).toBe(true)
   expect(await resolveContextReference(h.db,context,{kind:'product',selection:'other',operation_id:'cart'})).toMatchObject({ok:true,data:{option:{id:'racao-a'},requires_revalidation:true}})
   expect(await resolveContextReference(h.db,context,{kind:'product',selection:'single'})).toMatchObject({ok:false,code:'CONTEXT_REFERENCE_AMBIGUOUS'})
   const before=await h.state()
   await h.db.prepare(`UPDATE luna_conversation_memory SET context_json=?2 WHERE tenant_id=?1`).bind(h.tenant,JSON.stringify({...memory,options:[{id:'fake',kind:'unknown'}]})).run()
   await expect(loadConversationMemory(h.db,context)).rejects.toThrow('CONVERSATION_MEMORY_UNKNOWN')
   expect(await h.state()).toEqual(before)
  }finally{h.close()}
 })
})
