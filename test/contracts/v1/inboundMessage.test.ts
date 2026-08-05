import { describe, expect, it } from 'vitest'

import {
  ContractValidationError,
  parseInboundMessageV1,
} from '../../../shared/contracts/v1/index'

const minimumTextMessage = {
  type: 'inbound_message',
  version: 1,
  tenant_id: 'tenant-a',
  message_id: 'message-1',
  channel: 'whatsapp',
  sender_id: '5511999999999',
  received_at: '2026-08-05T17:00:00-03:00',
  content: {
    kind: 'text',
    text: 'Quero agendar um banho',
  },
} as const

describe('InboundMessageV1', () => {
  it('aceita mensagem textual mínima', () => {
    expect(parseInboundMessageV1(minimumTextMessage)).toEqual(minimumTextMessage)
  })

  it('aceita mídia e atributos escalares serializáveis', () => {
    const parsed = parseInboundMessageV1({
      ...minimumTextMessage,
      message_id: 'message-2',
      conversation_id: 'conversation-1',
      customer_id: null,
      correlation_id: 'corr-2',
      content: {
        kind: 'media',
        media_type: 'image',
        media_id: 'media-1',
        mime_type: 'image/jpeg',
        caption: 'Foto do pet',
      },
      attributes: {
        forwarded: false,
        retry_count: 0,
        provider: 'meta',
        optional_value: null,
      },
    })

    expect(parsed.content.kind).toBe('media')
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('aceita localização com limites geográficos válidos', () => {
    const parsed = parseInboundMessageV1({
      ...minimumTextMessage,
      content: {
        kind: 'location',
        latitude: -21.1307,
        longitude: -42.3661,
        label: 'Muriaé',
      },
    })

    expect(parsed.content.kind).toBe('location')
  })

  it('rejeita texto vazio, canal desconhecido e campos extras', () => {
    expect(() => parseInboundMessageV1({
      ...minimumTextMessage,
      content: { kind: 'text', text: '   ' },
    })).toThrow(ContractValidationError)

    expect(() => parseInboundMessageV1({
      ...minimumTextMessage,
      channel: 'telegram',
    })).toThrow(ContractValidationError)

    expect(() => parseInboundMessageV1({
      ...minimumTextMessage,
      access_token: 'secret',
    })).toThrow(ContractValidationError)
  })

  it('rejeita atributos compostos para preservar serialização simples', () => {
    expect(() => parseInboundMessageV1({
      ...minimumTextMessage,
      attributes: {
        nested: { unsafe: true },
      },
    })).toThrow(ContractValidationError)
  })
})
