import { describe, expect, it } from 'vitest'
import { buildProductionWranglerConfig, PRODUCTION } from '../scripts/migration/production-cloudflare.mjs'

const base = {
  name: 'yuisync-edge-api',
  main: 'src/index.ts',
  compatibility_date: '2026-08-05',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: true,
  assets: { directory: '../../dist', binding: 'ASSETS' },
  env: {
    staging: {
      name: 'yuisync-edge-api-staging',
      durable_objects: { bindings: [{ name: 'COORDINATOR', class_name: 'CoordinationDurableObject' }] },
      exports: { CoordinationDurableObject: { type: 'durable-object', storage: 'sqlite' } },
    },
  },
}

const resources = {
  database: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  authDatabase: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
}

describe('production Cloudflare config', () => {
  it('isolates production resources and keeps the custom domain detached during canary', () => {
    const config = buildProductionWranglerConfig(base, resources)
    const production = config.env.production

    expect(production.name).toBe(PRODUCTION.worker)
    expect(production.routes).toBeUndefined()
    expect(production.vars).toMatchObject({
      APP_ENV: 'production',
      RELEASE_CHANNEL: 'production',
      EDGE_BETTER_AUTH_ENABLED: 'true',
      EDGE_AUTH_TRUSTED_ORIGINS: 'https://yuisync.app',
    })
    expect(production.d1_databases.map((binding) => [binding.binding, binding.database_name, binding.database_id])).toEqual([
      ['DB', 'yuisync-next-production', resources.database.id],
      ['AUTH_DB', 'yuisync-auth-production', resources.authDatabase.id],
    ])
    expect(production.queues.producers[0].queue).toBe('yuisync-events-production')
    expect(production.queues.consumers[0].dead_letter_queue).toBe('yuisync-events-dlq-production')
  })

  it('attaches only the canonical apex when explicitly requested', () => {
    const config = buildProductionWranglerConfig(base, resources, { attachDomain: true })
    expect(config.env.production.routes).toEqual([{ pattern: 'yuisync.app', custom_domain: true }])
  })

  it('refuses to reuse staging database identifiers', () => {
    expect(() => buildProductionWranglerConfig(base, {
      database: { id: '4abe6b77-3042-4960-88ef-1fdb43d488d1' },
      authDatabase: resources.authDatabase,
    })).toThrow(/REUSES_STAGING_RESOURCE/)
  })
})
