import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { LunaConversationRepository } from '../src/luna/conversationRepository'
import { loadPresentableProposals, recordProposalPresentation, renderProposalSummary, renderThinkProposalSummary } from '../src/luna/proposalPresentation'

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
      const prepared = await registry.execute('prepare_customer_registration', { customer_name: 'Mariana', pet_name: 'Theo', species: 'dog', breed: 'Poodle', weight_kg: 8, tutor_birth_date:'1990-05-14',cpf:'52998224725',postal_code:'36880000',address_number:'191',address_reference:'perto da praça' }, ctx)
      expect(prepared).toMatchObject({ ok: true })
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
      expect(await db.prepare('SELECT name,phone,document,birth_date,postal_code,address_number,address_reference FROM clients WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({ results: [{ name: 'Mariana', phone: ctx.customerAddress, document: '52998224725', birth_date: '1990-05-14', postal_code: '36880000', address_number: '191', address_reference: 'perto da praça' }] })
      expect(await db.prepare('SELECT name,breed,weight_kg FROM pets WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({ results: [{ name: 'Theo', breed: 'Poodle', weight_kg: 8 }] })
      expect(await registry.execute('prepare_customer_registration', { customer_name: 'Outra pessoa', pet_name: 'Outro', species: 'dog' }, confirmed)).toMatchObject({ ok: false, code: 'CUSTOMER_REGISTRATION_AMBIGUOUS' })
      const customer = await db.prepare('SELECT id FROM clients WHERE tenant_id=?1').bind(tenant).first<{id:string}>()
      expect(await registry.execute('prepare_pet_registration', { customer_id: customer!.id, pet_name: 'Theo', species: 'dog' }, confirmed)).toMatchObject({ ok: false, code: 'PET_REGISTRATION_AMBIGUOUS' })
    } finally { clock.mockRestore() }
  })

  it('cliente que só compra é cadastrado sem pet (rodada 3, testes 6 a 8)', async () => {
    const now = Date.now(), tenant = 'registration-without-pet'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: 'buyer', customerAddress: '5532999990306', phoneNumberId: 'fixture', sourceMessageId: 'prepare', traceId: 'registration-buyer', executionMode: 'fixture' as const }
    try {
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cadastro fictício','active',?2,?2)`).bind(tenant, now),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,ctx.customerAddress,now),
      ])
      await new LunaConversationRepository(db).ensureConversation(ctx)
      const registry = createLunaToolRegistry(db)
      const prepared = await registry.execute('prepare_customer_registration', { customer_name: 'Tiago Teste', tutor_birth_date:'1993-03-03',cpf:'01748332023',postal_code:'36889275',address_number:'306',address_reference:'casa amarela' }, ctx)
      expect(prepared).toMatchObject({ ok: true })
      const data = (prepared as { data: { proposal_id: string; proposal_version: number } }).data
      const reference = { proposal_id: data.proposal_id, proposal_version: data.proposal_version }
      const summary = renderProposalSummary((await loadPresentableProposals(db,ctx,[reference.proposal_id]))[0])
      expect(summary).toContain('Cliente: Tiago Teste')
      expect(summary).not.toMatch(/Pet:|Espécie/)
      await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','out',?2,'outbound','assistant',?3,?4)`).bind(tenant,ctx.conversationId,summary,now).run()
      await recordProposalPresentation(db,ctx,[reference.proposal_id],'out')
      clock.mockReturnValue(now+1)
      await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','confirm',?2,'confirm','inbound','customer','pode cadastrar',?3)`).bind(tenant,ctx.conversationId,Date.now()).run()
      const confirmed = { ...ctx, sourceMessageId: 'confirm' }
      expect(await registry.execute('commit_confirmed_proposal', reference, confirmed)).toMatchObject({ ok: true, data: { operation_kind: 'customer_registration', idempotent: false } })
      expect(await registry.execute('commit_confirmed_proposal', reference, confirmed)).toMatchObject({ ok: true, data: { idempotent: true } })
      expect(await db.prepare('SELECT name,document FROM clients WHERE tenant_id=?1').bind(tenant).all()).toMatchObject({ results: [{ name: 'Tiago Teste', document: '01748332023' }] })
      expect((await db.prepare('SELECT COUNT(*) n FROM pets WHERE tenant_id=?1').bind(tenant).first<{n:number}>())!.n).toBe(0)
    } finally { clock.mockRestore() }
  })

  it('CPF já cadastrado vindo de outro número confirma a pessoa e liga o número ao cliente', async () => {
    const now = Date.now(), tenant = 'registration-cpf-link'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const ctx = { tenantId: tenant, moduleId: 'petshop' as const, conversationId: 'relative', customerAddress: '5532988887777', phoneNumberId: 'fixture', sourceMessageId: 'prepare', traceId: 'registration-link', executionMode: 'fixture' as const }
    try {
      await db.batch([
        db.prepare(`INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?1,?1,'Cadastro fictício','active',?2,?2)`).bind(tenant, now),
        db.prepare(`INSERT INTO clients(tenant_id,module_id,id,name,document,phone,birth_date,address,neighborhood,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','ana','Ana Souza','52998224725','32999990000','1990-05-14','Rua das Flores','Centro','active',?2,?2)`).bind(tenant, now),
        db.prepare(`INSERT INTO pets(tenant_id,module_id,id,client_id,name,species,status,created_at_ms,updated_at_ms) VALUES(?1,'petshop','thor','ana','Thor','dog','active',?2,?2)`).bind(tenant, now),
        db.prepare(`INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,last_message_at_ms,created_at_ms,updated_at_ms) VALUES(?1,'petshop',?2,'whatsapp',?3,'open',?4,?4,?4)`).bind(tenant,ctx.conversationId,ctx.customerAddress,now),
      ])
      await new LunaConversationRepository(db).ensureConversation(ctx)
      const registry = createLunaToolRegistry(db)
      const fields = { customer_name: 'Ana', species: 'dog', tutor_birth_date:'1990-05-14', cpf:'52998224725', postal_code:'36880000', address_number:'191' }
      expect(await registry.execute('get_customer_context', {}, ctx)).toMatchObject({ ok: false, code: 'CUSTOMER_NOT_FOUND' })
      // Someone else's birth date: the record is not revealed.
      expect(await registry.execute('prepare_customer_registration', { ...fields, pet_name: 'Thor', tutor_birth_date: '1991-01-01' }, ctx)).toMatchObject({ ok: false, code: 'CPF_ON_FILE_MISMATCH' })
      const prepared = await registry.execute('prepare_customer_registration', { ...fields, pet_name: 'Mel', breed: 'shitzu' }, ctx)
      expect(prepared).toMatchObject({ ok: true })
      const data = (prepared as { data: { proposal_id: string; proposal_version: number } }).data
      const reference = { proposal_id: data.proposal_id, proposal_version: data.proposal_version }
      const summary = renderThinkProposalSummary((await loadPresentableProposals(db,ctx,[reference.proposal_id]))[0], 'America/Sao_Paulo')
      expect(summary).toBe('Já temos seu cadastro aqui!\nVocê é Ana Souza, da Rua das Flores, Centro?\nVou incluir Mel (Shih Tzu) no seu cadastro.\nVocê confirma?')
      await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','out',?2,'outbound','assistant',?3,?4)`).bind(tenant,ctx.conversationId,summary,now).run()
      await recordProposalPresentation(db,ctx,[reference.proposal_id],'out',{timezone:'America/Sao_Paulo'})
      clock.mockReturnValue(now+1)
      await db.prepare(`INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,external_message_id,direction,actor_type,content_text,created_at_ms) VALUES(?1,'petshop','yes',?2,'yes','inbound','customer','s',?3)`).bind(tenant,ctx.conversationId,Date.now()).run()
      expect(await registry.execute('commit_confirmed_proposal', reference, { ...ctx, sourceMessageId: 'yes' })).toMatchObject({ ok: true })
      // No second client: the number now belongs to Ana, with both pets.
      expect(await db.prepare('SELECT count(*) n FROM clients WHERE tenant_id=?1').bind(tenant).first()).toEqual({ n: 1 })
      const customer = await registry.execute('get_customer_context', {}, ctx) as { ok: boolean; data: { customer: { id: string }; pets: { name: string; breed: string | null }[] } }
      expect(customer.data.customer.id).toBe('ana')
      expect(customer.data.pets.map(p => [p.name, p.breed])).toEqual([['Mel', 'Shih Tzu'], ['Thor', null]])
    } finally { clock.mockRestore() }
  })
})
