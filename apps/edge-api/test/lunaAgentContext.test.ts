import { describe, expect, it } from 'vitest'
import { agentMemory, agentToolMessage, agentContextMessages } from '../src/luna/agentContext'
import type { OperationalState } from '../src/luna/operationalState'

const state:OperationalState={schemaVersion:1,version:1,focus:'cart',operations:{cart:{id:'cart',kind:'cart',status:'active',version:1,fields:{address:'Rua completa 123'},items:[{id:'real-product',quantity:2}]}}}
describe('agent context uses one authoritative state',()=>{
  it('omits derived snapshots without losing accepted references or question target',()=>{
    const memory={schemaVersion:1 as const,options:[{id:'real-product',kind:'product' as const,label:'Ração A',observedAtMs:1000}],question:'fulfillment',targetOperationId:'cart',focus:'cart',paused:[],summary:JSON.stringify(state)}
    expect(JSON.parse(agentMemory(memory))).toEqual({...memory,summary:undefined})
    const messages=agentContextMessages([{role:'system',content:`MEMÓRIA OPERACIONAL D1: ${JSON.stringify(state)}`},{role:'user',content:'Troque por esse e entregue na Rua completa 123'}],state)
    expect(messages).toHaveLength(3)
    expect(messages[0].content).toContain('Rua completa 123')
    expect(messages[1].content).toContain(JSON.stringify(state))
    expect(messages[2].content).toContain('"fields":["fulfillment"]')
  })
  it('compacts a successful draft acknowledgment, never an error or query result',()=>{
    const raw={ok:true as const,data:{decision:{events:[state]},state,commercial_effect:false}}
    const result=agentToolMessage('record_turn_decision',raw)
    expect(result.length).toBeLessThan(JSON.stringify(raw).length/2)
    expect(JSON.parse(result)).toEqual({ok:true,data:{persisted:true,version:1,commercial_effect:false}})
    const failure={ok:false as const,code:'OPERATION_VERSION_STALE',retryable:false}
    expect(agentToolMessage('record_turn_decision',failure)).toBe(JSON.stringify(failure))
    expect(agentToolMessage('search_products',raw)).toBe(JSON.stringify(raw))
  })
})
