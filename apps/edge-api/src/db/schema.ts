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

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey().notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('tenants_slug_unique').on(table.slug),
  index('tenants_status_idx').on(table.status, table.id),
])

export const identityPrincipals = sqliteTable('identity_principals', {
  id: text('id').primaryKey().notNull(),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  displayName: text('display_name'),
  email: text('email'),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('identity_principals_provider_subject_unique').on(
    table.provider,
    table.subject,
  ),
  index('identity_principals_status_idx').on(table.status, table.id),
])

export const tenantMemberships = sqliteTable('tenant_memberships', {
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onUpdate: 'restrict', onDelete: 'restrict' }),
  principalId: text('principal_id')
    .notNull()
    .references(() => identityPrincipals.id, { onUpdate: 'restrict', onDelete: 'restrict' }),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  primaryKey({
    name: 'pk_tenant_memberships',
    columns: [table.tenantId, table.principalId],
  }),
  index('tenant_memberships_principal_status_idx').on(
    table.principalId,
    table.status,
    table.tenantId,
  ),
  index('tenant_memberships_tenant_status_idx').on(
    table.tenantId,
    table.status,
    table.principalId,
  ),
])

export type SystemMetadata = typeof systemMetadata.$inferSelect
export type EventProcessingRecord = typeof eventProcessing.$inferSelect
export type TenantRecord = typeof tenants.$inferSelect
export type IdentityPrincipalRecord = typeof identityPrincipals.$inferSelect
export type TenantMembershipRecord = typeof tenantMemberships.$inferSelect
