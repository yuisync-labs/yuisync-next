import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import type { EventProcessingStatus } from '../../../../server/application/ports/messaging'

export const systemMetadata = sqliteTable('_yuisync_system_metadata', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const eventProcessing = sqliteTable('_yuisync_event_processing', {
  tenantId: text('tenant_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  eventId: text('event_id').notNull(),
  eventName: text('event_name').notNull(),
  eventVersion: integer('event_version').notNull(),
  status: text('status').$type<EventProcessingStatus>().notNull(),
  attemptCount: integer('attempt_count').notNull().default(1),
  claimToken: text('claim_token').notNull(),
  leaseExpiresAtMs: integer('lease_expires_at_ms').notNull(),
  lastErrorCode: text('last_error_code'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  primaryKey({
    name: 'pk_yuisync_event_processing',
    columns: [table.tenantId, table.idempotencyKey],
  }),
  uniqueIndex('uq_yuisync_event_processing_event_id').on(table.eventId),
  index('idx_yuisync_event_processing_status_lease').on(
    table.status,
    table.leaseExpiresAtMs,
  ),
])

export type SystemMetadata = typeof systemMetadata.$inferSelect
export type EventProcessingRecord = typeof eventProcessing.$inferSelect
