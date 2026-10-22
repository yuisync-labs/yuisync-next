import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { loadPresentableProposals, recordProposalPresentation, renderProposalSummary } from '../src/luna/proposalPresentation'
import { saleDeliveryAddressStatement } from '../src/saleDeliveryAddress'
const db=(env as EdgeEnv & {DB:D1Database}).DB

describe('Luna delivery native commit — real local D1',()=>{
  it('endereço/taxa ficam na mesma transação; mudança de cobertura exige novo resumo',async()=>{
    const tenant='luna-delivery-commit',now=Date.now(),phone='5532999990909'
    const clock=vi.spyOn(Date,'now').mockReturnValue(now)
    const areas=[{city:'Cidade Teste',neighborhood:'Centro',active:true,fee_cents:1500}]
    const address={street:'Rua Teste',number:'20',city:'Cidade Teste',neighborhood:'Centro',reference:'portão azul'}
    try{
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Entrega fictícia','active',?2,?2)`).bind(tenant,now),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','customer','Maria',?2,'active',?3,?3)`).bind(tenant,phone,now),
        db.prepare(`INSERT INTO catalog_products(tenant_id,module_id,id,name,price_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','racao-a','Ração A',9000,'active',?2,?2)`).bind(tenant,now),
        db.prepare(`INSERT INTO inventory_balances(tenant_id,module_id,product_id,on_hand_milliunits,reserved_milliunits,reorder_milliunits,version,updated_at_ms) VALUES(?1,'petshop','racao-a',10000,0,0,1,?2)`).bind(tenant,now),
        db.prepare(`INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms) VALUES(?1,'petshop',?2,?3)`).bind(tenant,JSON.stringify({delivery_coverage:areas}),now),
      ])
      const registry=createLunaToolRegistry(db)
      for(const attempt of [1,2]){
        clock.mockReturnValue(now+attempt*10000)
        const ctx={tenantId:tenant,moduleId:'petshop' as const,conversationId:`delivery-${attempt}`,customerAddress:phone,phoneNumberId:'fixture',sourceMessageId:'prepare',traceId:`delivery-${attempt}`,executionMode:'fixture' as const}
        await db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?2,'open',?3,?3,?3)`).bind(tenant,ctx.conversationId,Date.now()).run()
        const result=await registry.execute('prepare_product_order',{customer_id:'customer',items:[{product_id:'racao-a',quantity:1}],fulfillment_type:'delivery',delivery_address:address},ctx)
        expect(result.ok).toBe(true)
        const data=(result as {data:{proposal_id:string;proposal_version:number}}).data
        const reference={proposal_id:data.proposal_id,proposal_version:data.proposal_version}
        const summary=renderProposalSummary((await loadPresentableProposals(db,ctx,[data.proposal_id]))[0])
        expect(summary).toContain('Total: R$ 105,00')
        expect(summary).toContain('Taxa de entrega: R$ 15,00')
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,'outbound','assistant',?4,?5)`).bind(tenant,`out-${attempt}`,ctx.conversationId,summary,Date.now()).run()
        await recordProposalPresentation(db,ctx,[data.proposal_id],`out-${attempt}`)
        clock.mockReturnValue(Date.now()+1)
        await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop',?2,?3,?2,'inbound','customer','Confirmo.',?4)`).bind(tenant,`in-${attempt}`,ctx.conversationId,Date.now()).run()
        if(attempt===2)await db.prepare(`UPDATE module_settings_extensions SET data_json=?2 WHERE tenant_id=?1`).bind(tenant,JSON.stringify({delivery_coverage:[{...areas[0],fee_cents:1600}]})).run()
        const committed=await registry.execute('commit_confirmed_proposal',reference,{...ctx,sourceMessageId:`in-${attempt}`})
        expect(committed).toMatchObject(attempt===1?{ok:true,data:{operation_kind:'product_order_create',status:'pending'}}:{ok:false,code:'DELIVERY_QUOTE_CHANGED'})
      }
      expect(await db.prepare('SELECT subtotal_cents,transport_fee_cents,total_cents,status FROM sales WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({results:[{subtotal_cents:9000,transport_fee_cents:1500,total_cents:10500,status:'pending'}]})
      expect(await db.prepare('SELECT street,number,reference,fee_cents FROM sale_delivery_addresses WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({results:[{street:'Rua Teste',number:'20',reference:'portão azul',fee_cents:1500}]})
      expect(await db.prepare('SELECT reserved_milliunits,on_hand_milliunits FROM inventory_balances WHERE tenant_id=?1').bind(tenant).first()).toEqual({reserved_milliunits:1000,on_hand_milliunits:10000})
      // Even a config race after the application read rolls back the whole batch.
      await expect(db.batch([
        db.prepare(`INSERT INTO sales(tenant_id,module_id,id,operation_key,source,fulfillment_type,subtotal_cents,discount_cents,transport_fee_cents,total_cents,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','raced','raced','whatsapp','delivery',9000,0,1500,10500,'pending',?2,?2)`).bind(tenant,now),
        saleDeliveryAddressStatement(db,{tenantId:tenant,moduleId:'petshop',saleId:'raced',address:{...address,complement:null,postal_code:null,fee_cents:1500,coverage_snapshot_json:JSON.stringify(areas)},now}),
      ])).rejects.toThrow('DELIVERY_QUOTE_CHANGED')
      expect(await db.prepare(`SELECT id FROM sales WHERE tenant_id=?1 AND id='raced'`).bind(tenant).first()).toBeNull()
      expect(await db.prepare('SELECT COUNT(*) AS count FROM payments WHERE tenant_id=?1').bind(tenant).first()).toEqual({count:0})
    }finally{clock.mockRestore()}
  })
})
