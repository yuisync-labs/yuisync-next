import type {
  WhatsAppAccountConnectionV1,
  WhatsAppSendCommandV1,
  WhatsAppSendResultV1,
} from '../../../shared/contracts/v1/index'

export type WhatsAppConnectionPersistenceReceipt = Readonly<{
  tenantId: string
  phoneNumberId: string
  created: boolean
  updated: boolean
}>

export interface WhatsAppConnectionRepositoryPort {
  findByTenantId(tenantId: string): Promise<readonly WhatsAppAccountConnectionV1[]>
  findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppAccountConnectionV1 | null>
  findByWabaId(wabaId: string): Promise<readonly WhatsAppAccountConnectionV1[]>
  save(connection: WhatsAppAccountConnectionV1): Promise<WhatsAppConnectionPersistenceReceipt>
}

export interface WhatsAppMessagingPort {
  sendText(command: WhatsAppSendCommandV1): Promise<WhatsAppSendResultV1>
}
