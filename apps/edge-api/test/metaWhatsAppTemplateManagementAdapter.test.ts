import { describe, expect, it } from 'vitest'

import {
  MetaWhatsAppTemplateManagementAdapter,
} from '../src/adapters/metaWhatsAppTemplateManagementAdapter'

const TENANT = 'tenant-template-001'
const WABA = '123456789012345'

function credentials(token = 'template-secret-token') {
  return {
    async resolveForWaba(tenantId: string, wabaId: string) {
      expect(tenantId).toBe(TENANT)
      expect(wabaId).toBe(WABA)
      return { accessToken: token }
    },
  }
}

describe('MetaWhatsAppTemplateManagementAdapter', () => {
  it('lista templates pelo WABA e normaliza a resposta', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const adapter = new MetaWhatsAppTemplateManagementAdapter({
      credentials: credentials(),
      fetchFn: async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) })
        return Response.json({
          data: [{ id: 'template-001', name: 'appointment_confirmed', status: 'APPROVED', category: 'UTILITY', language: 'pt_BR' }],
        })
      },
    })

    await expect(adapter.listTemplates({ tenantId: TENANT, wabaId: WABA })).resolves.toEqual([{
      id: 'template-001',
      name: 'appointment_confirmed',
      status: 'APPROVED',
      category: 'UTILITY',
      language: 'pt_BR',
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain(`/${WABA}/message_templates?`)
    expect(calls[0].headers.get('authorization')).toBe('Bearer template-secret-token')
  })

  it('cria template sem expor detalhes Graph no contrato de aplicação', async () => {
    let body: Record<string, unknown> = {}
    const adapter = new MetaWhatsAppTemplateManagementAdapter({
      credentials: credentials(),
      fetchFn: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({ id: 'template-002', status: 'PENDING', category: 'UTILITY' }, { status: 200 })
      },
    })

    await expect(adapter.createTemplate({
      tenantId: TENANT,
      wabaId: WABA,
      name: 'appointment_reminder',
      language: 'pt_BR',
      category: 'UTILITY',
      bodyText: 'Seu atendimento está agendado.',
    })).resolves.toEqual({ id: 'template-002', status: 'PENDING', category: 'UTILITY' })

    expect(body).toMatchObject({
      name: 'appointment_reminder',
      language: 'pt_BR',
      category: 'UTILITY',
      allow_category_change: true,
    })
  })

  it('falha fechado quando a credencial do tenant/WABA não é resolvida', async () => {
    let calls = 0
    const adapter = new MetaWhatsAppTemplateManagementAdapter({
      credentials: { async resolveForWaba() { return null } },
      fetchFn: async () => {
        calls += 1
        return Response.json({})
      },
    })

    await expect(adapter.listTemplates({ tenantId: TENANT, wabaId: WABA })).rejects.toMatchObject({
      code: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED',
      retryable: false,
    })
    expect(calls).toBe(0)
  })

  it('classifica rejeição Graph sem colocar token na mensagem de erro', async () => {
    const token = 'token-that-must-not-leak'
    const adapter = new MetaWhatsAppTemplateManagementAdapter({
      credentials: credentials(token),
      fetchFn: async () => Response.json({ error: { code: 100, message: `bad ${token}` } }, { status: 400 }),
    })

    let error: unknown
    try {
      await adapter.listTemplates({ tenantId: TENANT, wabaId: WABA })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'WHATSAPP_TEMPLATE_GRAPH_REJECTED', retryable: false, providerCode: '100' })
    expect(String((error as Error).message)).not.toContain(token)
  })
})
