import type {
  PendingConfirmationV1,
  ProductOrderV1,
  ServiceBookingV1,
} from '../../../shared/contracts/v1/index'

export type PersistenceReceipt = Readonly<{
  id: string
  version: number
  created: boolean
}>

export interface ProductOrderRepositoryPort {
  save(order: ProductOrderV1): Promise<PersistenceReceipt>
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ProductOrderV1 | null>
}

export interface ServiceBookingRepositoryPort {
  save(booking: ServiceBookingV1): Promise<PersistenceReceipt>
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ServiceBookingV1 | null>
}

export interface PendingConfirmationRepositoryPort {
  save(confirmation: PendingConfirmationV1): Promise<PersistenceReceipt>
  findById(tenantId: string, confirmationId: string): Promise<PendingConfirmationV1 | null>
}
