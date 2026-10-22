import {describe,expect,it} from 'vitest'
import {LunaConversationRepository} from '../src/luna/conversationRepository'
import {createDesignedHarness} from './fixtures/luna/designedRuntimeHarness'

describe('Luna causal history on real Worker/D1',()=>{
  it('preserves equal-timestamp insertion order, pagination and tenant isolation despite reversed UUID order',async()=>{
    const h=await createDesignedHarness(1,'-causal-history')
    try{
      for(const [id,direction,actor,message] of [
        ['z-inbound','inbound','customer','Quero uma Ração A.'],
        ['a-outbound','outbound','assistant','Você prefere retirar ou receber em casa?'],
        ['y-inbound','inbound','customer','Vou retirar na loja.'],
        ['b-outbound','outbound','assistant','Confira o resumo antes de confirmar.'],
      ])await h.db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?4,?5,?6,?7)`)
        .bind(h.tenant,id,h.ctx.conversationId,direction,actor,message,h.start).run()
      const repo=new LunaConversationRepository(h.db)
      const history=await repo.loadHistory(h.ctx)
      expect(history.map(m=>m.content)).toEqual(['Quero uma Ração A.','Você prefere retirar ou receber em casa?','Vou retirar na loja.','Confira o resumo antes de confirmar.'])
      expect(await repo.loadHistory(h.ctx,2)).toEqual(history.slice(-2))
      expect(await repo.loadHistory({...h.ctx,tenantId:'other'})).toEqual([])
      const plan=await h.db.prepare(`EXPLAIN QUERY PLAN SELECT direction,actor_type,content_text,created_at_ms,rowid FROM chat_messages WHERE tenant_id=?1 AND module_id=?2 AND thread_id=?3 AND trim(content_text)<>'' ORDER BY created_at_ms DESC,rowid DESC LIMIT 12`)
        .bind(h.tenant,'petshop',h.ctx.conversationId).all<{detail:string}>()
      expect(plan.results.map(r=>r.detail).join('\n')).toContain('chat_messages_thread_insertion_idx')
      expect(plan.results.map(r=>r.detail).join('\n')).not.toContain('TEMP B-TREE')
    }finally{h.close()}
  })
})
