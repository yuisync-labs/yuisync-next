import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { LunaConversationRepository } from '../src/luna/conversationRepository'
import { loadPresentableProposals, recordProposalPresentation, renderProposalSummary } from '../src/luna/proposalPresentation'

const db = (env as EdgeEnv & { DB: D1Database }).DB

describe('Luna registration — real Worker/local D1', () => {
  it('cadastro confirmado é atômico, vinculado ao telefone e idempotente', async () => {
    const now = Date.now(), tenant = 'registration-confirmed'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: 'registration', customerAddress: '5532999990100', phoneNumberId: 'fixture', sourceMessageId: 'prepare', traceId: 'registration-test', executionMode: 'fixture' as const }
    try {
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cadastro fictício','active',?2,?2)`).bind(tenant, now),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,ctx.customerAddress,now),
      ])
      await new LunaConversationRepository(db).ensureConversation(ctx)
      const registry = createLunaToolRegistry(db)
      const prepared = await registry.execute('prepare_customer_registration', { customer_name: 'Mariana', pet_name: 'Theo', species: 'dog', breed: 'Poodle', weight_kg: 8 }, ctx)
      expect(prepared.ok).toBe(true)
      const data = (prepared as { data: { proposal_id: string; proposal_version: number } }).data
      const reference = { proposal_id: data.proposal_id, proposal_version: data.proposal_version }
      expect(await db.prepare('SELECT id FROM clients WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({ results: [] })
      expect(await registry.execute('commit_confirmed_proposal', reference, ctx)).toMatchObject({ ok: false })
      const proposal = (await loadPresentableProposals(db,ctx,[reference.proposal_id]))[0]
      const summary = renderProposalSummary(proposal)
      expect(summary).toContain('Cliente: Mariana')
      expect(summary).toContain('Peso: 8 kg')
      await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','out',?2,'outbound','assistant',?3,?4)`).bind(tenant,ctx.conversationId,summary,now).run()
      await recordProposalPresentation(db,ctx,[reference.proposal_id],'out')
      clock.mockReturnValue(now+1)
      await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','confirm',?2,'confirm','inbound','customer','Confirmo o cadastro',?3)`).bind(tenant,ctx.conversationId,Date.now()).run()
      const confirmed = { ...ctx, sourceMessageId: 'confirm' }
      expect(await registry.execute('commit_confirmed_proposal', reference, { ...confirmed, customerAddress: '5532999990101' })).toMatchObject({ ok: false, code: 'CUSTOMER_SCOPE_DENIED' })
      const committed = await registry.execute('commit_confirmed_proposal', reference, confirmed)
      expect(committed).toMatchObject({ ok: true, data: { operation_kind: 'customer_registration', idempotent: false } })
      expect(await registry.execute('commit_confirmed_proposal', reference, confirmed)).toMatchObject({ ok: true, data: { idempotent: true } })
      expect(await db.prepare('SELECT name,phone FROM clients WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({ results: [{ name: 'Mariana', phone: ctx.customerAddress }] })
      expect(await db.prepare('SELECT name,breed,weight_kg FROM pets WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({ results: [{ name: 'Theo', breed: 'Poodle', weight_kg: 8 }] })
      expect(await registry.execute('prepare_customer_registration', { customer_name: 'Outra pessoa', pet_name: 'Outro', species: 'dog' }, confirmed)).toMatchObject({ ok: false, code: 'CUSTOMER_REGISTRATION_AMBIGUOUS' })
      const customer = await db.prepare('SELECT id FROM clients WHERE tenant_id=?1').bind(tenant).first<{id:string}>()
      expect(await registry.execute('prepare_pet_registration', { customer_id: customer!.id, pet_name: 'Theo', species: 'dog' }, confirmed)).toMatchObject({ ok: false, code: 'PET_REGISTRATION_AMBIGUOUS' })
    } finally { clock.mockRestore() }
  })
})
