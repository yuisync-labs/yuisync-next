import { describe, expect, it } from 'vitest'

import {
  extractWhatsappStatusEvents,
  payloadContainsInboundMessages,
} from '../src/whatsappDeliveryStatusApi'

describe('WhatsApp delivery status webhook normalization', () => {
  it('normaliza status oficial da Meta sem carregar payload bruto para o domínio', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '123456789012345',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '16505553333',
              phone_number_id: '27681414235104944',
            },
            statuses: [{
              id: 'wamid.delivery-001',
              status: 'delivered',
              timestamp: '1786970400',
              recipient_id: '5532999999999',
            }],
          },
        }],
      }],
    }

    expect(extractWhatsappStatusEvents(payload)).toEqual([{
      wabaId: '123456789012345',
      phoneNumberId: '27681414235104944',
      providerMessageId: 'wamid.delivery-001',
      status: 'delivered',
      timestampMs: 1_786_970_400_000,
      recipientId: '5532999999999',
      errorCode: null,
    }])
    expect(payloadContainsInboundMessages(payload)).toBe(false)
  })

  it('extrai código sanitizado de status failed', () => {
    const payload = {
      entry: [{
        id: 'waba-failed',
        changes: [{ value: {
          metadata: { phone_number_id: '27681414235104944' },
          statuses: [{
            id: 'wamid.failed-002',
            status: 'failed',
            timestamp: '1786970500',
            recipient_id: '5532999999999',
            errors: [{ code: 131047, title: 'ignored by normalization' }],
          }],
        } }],
      }],
    }

    expect(extractWhatsappStatusEvents(payload)[0]).toMatchObject({
      providerMessageId: 'wamid.failed-002',
      status: 'failed',
      errorCode: '131047',
    })
  })

  it('ignora status que não faz parte do lifecycle do YuiSync', () => {
    const payload = {
      entry: [{
        id: 'waba-001',
        changes: [{ value: {
          metadata: { phone_number_id: '27681414235104944' },
          statuses: [{ id: 'wamid.deleted', status: 'deleted', timestamp: '1786970600' }],
        } }],
      }],
    }
    expect(extractWhatsappStatusEvents(payload)).toEqual([])
  })

  it('detecta lote que também contém mensagem live para deixar o handler WA3 continuar', () => {
    const payload = {
      entry: [{
        id: 'waba-001',
        changes: [{ value: {
          metadata: { phone_number_id: '27681414235104944' },
          messages: [{ id: 'wamid.inbound', from: '5532999999999', type: 'text' }],
          statuses: [{ id: 'wamid.outbound', status: 'sent', timestamp: '1786970700' }],
        } }],
      }],
    }
    expect(payloadContainsInboundMessages(payload)).toBe(true)
    expect(extractWhatsappStatusEvents(payload)).toHaveLength(1)
  })
})
