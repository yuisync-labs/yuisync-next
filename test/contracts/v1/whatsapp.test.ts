import { describe, expect, it } from 'vitest'

import {
  ContractValidationError,
  parseIncomingWhatsAppMessageV1,
  parseWhatsAppAccountConnectionV1,
  parseWhatsAppSendCommandV1,
  parseWhatsAppSendResultV1,
} from '../../../shared/contracts/v1/index'

const connection = {
  type: 'whatsapp_account_connection',
  version: 1,
  tenant_id: 'tenant-a',
  business_id: 'business-a',
  waba_id: 'waba-a',
  phone_number_id: 'phone-a',
  status: 'connected',
} as const

const incomingText = {
  type: 'incoming_whatsapp_message',
  version: 1,
  tenant_id: 'tenant-a',
  waba_id: 'waba-a',
  phone_number_id: 'phone-a',
  message_id: 'wamid.message-1',
  from: '5532999999999',
  timestamp: '2026-08-17T13:30:00-03:00',
  message_type: 'text',
  text: 'Olá',
  correlation_id: 'corr-in-1',
} as const

const sendCommand = {
  type: 'whatsapp_send_command',
  version: 1,
  tenant_id: 'tenant-a',
  conversation_id: 'conversation-a',
  to: '5532999999999',
  body: 'Olá pelo atendimento',
  idempotency_key: 'send-tenant-a-conversation-a-1',
  correlation_id: 'corr-out-1',
} as const

describe('WhatsAppAccountConnectionV1', () => {
  it('aceita vínculo mínimo multi-tenant sem credenciais', () => {
    expect(parseWhatsAppAccountConnectionV1(connection)).toEqual(connection)
  })

  it('aceita metadados públicos opcionais e serializa de ida e volta', () => {
    const parsed = parseWhatsAppAccountConnectionV1({
      ...connection,
      display_phone_number: '+55 32 99999-9999',
      verified_name: 'Loja de homologação',
    })

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
  })

  it('exige tenant e rejeita credenciais ou campos Meta brutos extras', () => {
    const { tenant_id: _tenantId, ...withoutTenant } = connection

    expect(() => parseWhatsAppAccountConnectionV1(withoutTenant)).toThrow(ContractValidationError)
    expect(() => parseWhatsAppAccountConnectionV1({
      ...connection,
      access_token: 'should-never-enter-the-contract',
    })).toThrow(ContractValidationError)
  })
})

describe('IncomingWhatsAppMessageV1', () => {
  it('aceita mensagem textual já normalizada', () => {
    expect(parseIncomingWhatsAppMessageV1(incomingText)).toEqual(incomingText)
  })

  it('exige texto quando message_type for text', () => {
    const { text: _text, ...withoutText } = incomingText
    expect(() => parseIncomingWhatsAppMessageV1(withoutText)).toThrow(ContractValidationError)
  })

  it('rejeita timestamp Meta bruto e payload/provider extras', () => {
    expect(() => parseIncomingWhatsAppMessageV1({
      ...incomingText,
      timestamp: '1723912200',
    })).toThrow(ContractValidationError)

    expect(() => parseIncomingWhatsAppMessageV1({
      ...incomingText,
      entry: [{ changes: [] }],
    })).toThrow(ContractValidationError)
  })
})

describe('WhatsAppSendCommandV1', () => {
  it('exige idempotency key e tenant explícitos', () => {
    expect(parseWhatsAppSendCommandV1(sendCommand)).toEqual(sendCommand)

    const { idempotency_key: _idempotencyKey, ...withoutIdempotency } = sendCommand
    expect(() => parseWhatsAppSendCommandV1(withoutIdempotency)).toThrow(ContractValidationError)

    const { tenant_id: _tenantId, ...withoutTenant } = sendCommand
    expect(() => parseWhatsAppSendCommandV1(withoutTenant)).toThrow(ContractValidationError)
  })

  it('rejeita segredo injetado e corpo vazio', () => {
    expect(() => parseWhatsAppSendCommandV1({
      ...sendCommand,
      authorization: 'Bearer secret',
    })).toThrow(ContractValidationError)

    expect(() => parseWhatsAppSendCommandV1({
      ...sendCommand,
      body: '   ',
    })).toThrow(ContractValidationError)
  })
})

describe('WhatsAppSendResultV1', () => {
  it('representa confirmação real do transporte sem fingir sucesso', () => {
    const parsed = parseWhatsAppSendResultV1({
      type: 'whatsapp_send_result',
      version: 1,
      tenant_id: 'tenant-a',
      conversation_id: 'conversation-a',
      idempotency_key: 'send-tenant-a-conversation-a-1',
      provider_message_id: 'wamid.response-1',
      status: 'submitted',
      occurred_at: '2026-08-17T13:31:00-03:00',
      correlation_id: 'corr-out-1',
    })

    expect(parsed.status).toBe('submitted')
  })

  it('permite falha categorizada sem transportar detalhes sensíveis', () => {
    const parsed = parseWhatsAppSendResultV1({
      type: 'whatsapp_send_result',
      version: 1,
      tenant_id: 'tenant-b',
      conversation_id: 'conversation-b',
      idempotency_key: 'send-tenant-b-conversation-b-1',
      status: 'failed',
      occurred_at: '2026-08-17T13:32:00-03:00',
      error_code: 'META_SEND_REJECTED',
    })

    expect(parsed.tenant_id).toBe('tenant-b')
    expect(parsed.status).toBe('failed')
  })
})
