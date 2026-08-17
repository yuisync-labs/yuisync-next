import { describe, expect, it } from 'vitest'

import {
  META_WHATSAPP_GRAPH_VERSION,
  MetaWhatsAppGraphAdapter,
  MetaWhatsAppGraphError,
  type MetaWhatsAppCredentialsResolver,
} from '../src/adapters/metaWhatsAppGraphAdapter'

function command(overrides: Record<string, unknown> = {}) {
  return {
    type: 'whatsapp_send_command' as const,
    version: 1 as const,
    tenant_id: 'tenant-petshop-001',
    conversation_id: 'conversation-wa-001',
    to: '+5532999999999',
    body: 'Olá pelo YuiSync',
    idempotency_key: 'wa-send-001',
    correlation_id: 'correlation-wa-001',
    ...overrides,
  }
}

function credentials(accessToken = 'secret-meta-token'): MetaWhatsAppCredentialsResolver {
  return {
    async resolveForTenant(tenantId) {
      expect(tenantId).toBe('tenant-petshop-001')
      return {
        accessToken,
        phoneNumberId: '112233445566778',
      }
    },
  }
}

describe('MetaWhatsAppGraphAdapter', () => {
  it('envia texto pelo endpoint versionado e normaliza aceitação como submitted', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: credentials(),
      now: () => new Date('2026-08-17T17:30:00.000Z'),
      fetchFn: async (input, init) => {
        calls.push({ url: String(input), init })
        return Response.json({ messages: [{ id: 'wamid.yuisync-001' }] })
      },
    })

    const result = await adapter.sendText(command())

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://graph.facebook.com/${META_WHATSAPP_GRAPH_VERSION}/112233445566778/messages`)
    expect(calls[0].init?.method).toBe('POST')
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer secret-meta-token')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5532999999999',
      type: 'text',
      text: {
        preview_url: false,
        body: 'Olá pelo YuiSync',
      },
    })
    expect(result).toEqual({
      type: 'whatsapp_send_result',
      version: 1,
      tenant_id: 'tenant-petshop-001',
      conversation_id: 'conversation-wa-001',
      idempotency_key: 'wa-send-001',
      provider_message_id: 'wamid.yuisync-001',
      status: 'submitted',
      occurred_at: '2026-08-17T17:30:00.000Z',
      correlation_id: 'correlation-wa-001',
    })
  })

  it('não envia sem credencial explicitamente resolvida para o tenant', async () => {
    let fetchCalls = 0
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: { async resolveForTenant() { return null } },
      fetchFn: async () => {
        fetchCalls += 1
        return Response.json({})
      },
    })

    await expect(adapter.sendText(command())).rejects.toMatchObject({
      name: 'MetaWhatsAppGraphError',
      code: 'WHATSAPP_GRAPH_NOT_CONFIGURED',
      retryable: false,
      correlationId: 'correlation-wa-001',
    })
    expect(fetchCalls).toBe(0)
  })

  it('rejeita destinatário inválido antes de consultar transporte', async () => {
    let credentialCalls = 0
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: {
        async resolveForTenant() {
          credentialCalls += 1
          return { accessToken: 'secret', phoneNumberId: '112233445566778' }
        },
      },
    })

    await expect(adapter.sendText(command({ to: 'destinatario-invalido' }))).rejects.toMatchObject({
      code: 'WHATSAPP_GRAPH_REJECTED',
      retryable: false,
    })
    expect(credentialCalls).toBe(0)
  })

  it('não repete erro Graph 4xx não transitório e não vaza token', async () => {
    const token = 'token-que-nao-pode-vazar'
    let fetchCalls = 0
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: credentials(token),
      sleep: async () => {},
      fetchFn: async () => {
        fetchCalls += 1
        return Response.json({
          error: {
            message: `provider echoed ${token}`,
            code: 100,
            error_subcode: 2018001,
            fbtrace_id: 'trace-meta-001',
          },
        }, { status: 400 })
      },
    })

    let caught: unknown
    try {
      await adapter.sendText(command())
    } catch (error) {
      caught = error
    }

    expect(fetchCalls).toBe(1)
    expect(caught).toBeInstanceOf(MetaWhatsAppGraphError)
    expect(caught).toMatchObject({
      code: 'WHATSAPP_GRAPH_REJECTED',
      retryable: false,
      httpStatus: 400,
      providerCode: '100',
      providerSubcode: '2018001',
      providerTraceId: 'trace-meta-001',
      correlationId: 'correlation-wa-001',
    })
    expect(JSON.stringify(caught)).not.toContain(token)
    expect(caught instanceof Error ? caught.message : '').not.toContain(token)
  })

  it('repete somente falhas HTTP transitórias com backoff limitado', async () => {
    const delays: number[] = []
    let fetchCalls = 0
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: credentials(),
      maxAttempts: 3,
      sleep: async (milliseconds) => { delays.push(milliseconds) },
      fetchFn: async () => {
        fetchCalls += 1
        if (fetchCalls === 1) return Response.json({ error: { code: 4 } }, { status: 429 })
        if (fetchCalls === 2) return Response.json({ error: { code: 2 } }, { status: 503 })
        return Response.json({ messages: [{ id: 'wamid.after-retry' }] })
      },
    })

    const result = await adapter.sendText(command())

    expect(fetchCalls).toBe(3)
    expect(delays).toEqual([150, 300])
    expect(result.status).toBe('submitted')
    expect(result.provider_message_id).toBe('wamid.after-retry')
  })

  it('classifica falha de rede esgotada como transitória sem expor detalhes do fetch', async () => {
    let fetchCalls = 0
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: credentials(),
      maxAttempts: 2,
      sleep: async () => {},
      fetchFn: async () => {
        fetchCalls += 1
        throw new TypeError('network failure with internal detail')
      },
    })

    await expect(adapter.sendText(command())).rejects.toMatchObject({
      name: 'MetaWhatsAppGraphError',
      code: 'WHATSAPP_GRAPH_UNAVAILABLE',
      retryable: true,
      correlationId: 'correlation-wa-001',
    })
    expect(fetchCalls).toBe(2)
  })

  it('classifica AbortError como timeout transitório', async () => {
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: credentials(),
      maxAttempts: 1,
      fetchFn: async () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
    })

    await expect(adapter.sendText(command())).rejects.toMatchObject({
      code: 'WHATSAPP_GRAPH_TIMEOUT',
      retryable: true,
    })
  })

  it('rejeita resposta 2xx sem message id como resposta inválida não transitória', async () => {
    const adapter = new MetaWhatsAppGraphAdapter({
      credentials: credentials(),
      fetchFn: async () => Response.json({ messages: [{}] }),
    })

    await expect(adapter.sendText(command())).rejects.toMatchObject({
      code: 'WHATSAPP_GRAPH_INVALID_RESPONSE',
      retryable: false,
      httpStatus: 200,
    })
  })
})
