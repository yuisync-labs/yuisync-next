import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { tenants } from './schema'

export const catalogProducts = sqliteTable('catalog_products', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onUpdate: 'restrict', onDelete: 'restrict' }),
  moduleId: text('module_id').notNull(),
  id: text('id').notNull(),
  name: text('name').notNull(),
  barcode: text('barcode'),
  category: text('category'),
  description: text('description'),
  priceCents: integer('price_cents').notNull().default(0),
  costCents: integer('cost_cents').notNull().default(0),
  speciesTarget: text('species_target'),
  upsellProductId: text('upsell_product_id'),
  imageUrl: text('image_url'),
  botMetadataJson: text('bot_metadata_json').notNull().default('{}'),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  primaryKey({ name: 'pk_catalog_products', columns: [table.tenantId, table.moduleId, table.id] }),
  foreignKey({
    name: 'fk_catalog_products_upsell_scope',
    columns: [table.tenantId, table.moduleId, table.upsellProductId],
    foreignColumns: [table.tenantId, table.moduleId, table.id],
  }).onUpdate('restrict').onDelete('set null'),
  uniqueIndex('catalog_products_scope_barcode_unique').on(table.tenantId, table.moduleId, table.barcode),
  index('catalog_products_scope_status_name_idx').on(table.tenantId, table.moduleId, table.status, table.name, table.id),
])

export const services = sqliteTable('services', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onUpdate: 'restrict', onDelete: 'restrict' }),
  moduleId: text('module_id').notNull(),
  id: text('id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  category: text('category'),
  description: text('description'),
  groupType: text('group_type', { enum: ['banho_tosa', 'veterinaria', 'motoboy', 'outro'] }).notNull(),
  defaultPriceCents: integer('default_price_cents').notNull().default(0),
  defaultDurationMin: integer('default_duration_min').notNull().default(60),
  commissionType: text('commission_type', { enum: ['percentage'] }).notNull().default('percentage'),
  commissionBasisPoints: integer('commission_basis_points').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(999),
  icon: text('icon'),
  sourceProductId: text('source_product_id'),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  primaryKey({ name: 'pk_services', columns: [table.tenantId, table.moduleId, table.id] }),
  foreignKey({
    name: 'fk_services_product_scope',
    columns: [table.tenantId, table.moduleId, table.sourceProductId],
    foreignColumns: [catalogProducts.tenantId, catalogProducts.moduleId, catalogProducts.id],
  }).onUpdate('restrict').onDelete('restrict'),
  uniqueIndex('services_scope_code_unique').on(table.tenantId, table.moduleId, table.code),
  uniqueIndex('services_scope_source_product_unique').on(table.tenantId, table.moduleId, table.sourceProductId),
  index('services_scope_group_status_idx').on(table.tenantId, table.moduleId, table.groupType, table.status, table.sortOrder, table.id),
])

export type CatalogProductRecord = typeof catalogProducts.$inferSelect
export type ServiceRecord = typeof services.$inferSelect