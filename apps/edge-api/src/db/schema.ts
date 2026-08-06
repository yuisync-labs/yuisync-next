import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const systemMetadata = sqliteTable('_yuisync_system_metadata', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
})

export type SystemMetadata = typeof systemMetadata.$inferSelect
