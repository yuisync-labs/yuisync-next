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

export type WhatsAppAccessCredential = Readonly<{
  tenantId: string
  phoneNumberId: string
  accessToken: string
}>

export interface WhatsAppCredentialVaultPort {
  save(credential: WhatsAppAccessCredential): Promise<void>
  findByPhoneNumberId(tenantId: string, phoneNumberId: string): Promise<WhatsAppAccessCredential | null>
}

export type WhatsAppEmbeddedSignupCompletion = Readonly<{
  code: string
  wabaId: string
  phoneNumberId?: string | null
}>

export type WhatsAppEmbeddedSignupResult = Readonly<{
  connection: WhatsAppAccountConnectionV1
  accessToken: string
}>

export interface WhatsAppOnboardingPort {
  complete(input: WhatsAppEmbeddedSignupCompletion & Readonly<{ tenantId: string }>): Promise<WhatsAppEmbeddedSignupResult>
  subscribe(wabaId: string, accessToken: string): Promise<void>
}

export interface WhatsAppMessagingPort {
  sendText(command: WhatsAppSendCommandV1): Promise<WhatsAppSendResultV1>
}
