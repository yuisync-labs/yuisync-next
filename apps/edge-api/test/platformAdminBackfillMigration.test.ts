import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

type TestEnv = EdgeEnv & {
  DB: D1Database
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

describe('platform administrator backfill migration', () => {
  it('promotes only active legacy global profiles and remains idempotent', async () => {
    const testEnv = env as TestEnv
    const database = testEnv.DB
    const suffix = crypto.randomUUID()
    const now = Date.now()
    const activeAdmin = `backfill-admin-${suffix}`
    const inactiveAdmin = `backfill-inactive-${suffix}`
    const employee = `backfill-employee-${suffix}`
    const migration = testEnv.TEST_MIGRATIONS.find((entry) => entry.name.includes('0033_backfill_platform_administrators'))
    expect(migration).toBeTruthy()

    try {
      await database.batch([
        database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?1,?1,?2,'active',?3,?3)")
          .bind(activeAdmin, `${activeAdmin}@test.invalid`, now),
        database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?1,?1,?2,'active',?3,?3)")
          .bind(inactiveAdmin, `${inactiveAdmin}@test.invalid`, now),
        database.prepare("INSERT INTO identity_principals(id,provider,subject,display_name,email,status,created_at_ms,updated_at_ms) VALUES(?1,'better-auth',?1,?1,?2,'active',?3,?3)")
          .bind(employee, `${employee}@test.invalid`, now),
        database.prepare("INSERT INTO profiles(id,full_name,email,role,active,created_at,updated_at) VALUES(?1,?1,?2,'admin',1,?3,?3)")
          .bind(activeAdmin, `${activeAdmin}@test.invalid`, new Date(now).toISOString()),
        database.prepare("INSERT INTO profiles(id,full_name,email,role,active,created_at,updated_at) VALUES(?1,?1,?2,'admin',0,?3,?3)")
          .bind(inactiveAdmin, `${inactiveAdmin}@test.invalid`, new Date(now).toISOString()),
        database.prepare("INSERT INTO profiles(id,full_name,email,role,active,created_at,updated_at) VALUES(?1,?1,?2,'employee',1,?3,?3)")
          .bind(employee, `${employee}@test.invalid`, new Date(now).toISOString()),
      ])

      await database.prepare('DELETE FROM platform_administrators WHERE principal_id IN (?1,?2,?3)')
        .bind(activeAdmin, inactiveAdmin, employee)
        .run()
      await database.prepare('DELETE FROM d1_migrations WHERE name=?1').bind(migration!.name).run()
      await applyD1Migrations(database, [migration!])

      const rows = await database.prepare('SELECT principal_id FROM platform_administrators WHERE principal_id IN (?1,?2,?3) ORDER BY principal_id')
        .bind(activeAdmin, inactiveAdmin, employee)
        .all<{ principal_id: string }>()
      expect(rows.results.map((row) => row.principal_id)).toEqual([activeAdmin])

      await database.prepare('DELETE FROM d1_migrations WHERE name=?1').bind(migration!.name).run()
      await applyD1Migrations(database, [migration!])
      const count = await database.prepare('SELECT COUNT(*) AS count FROM platform_administrators WHERE principal_id=?1')
        .bind(activeAdmin)
        .first<{ count: number }>()
      expect(count?.count).toBe(1)
    } finally {
      await database.prepare('DELETE FROM platform_administrators WHERE principal_id IN (?1,?2,?3)').bind(activeAdmin, inactiveAdmin, employee).run()
      await database.prepare('DELETE FROM profiles WHERE id IN (?1,?2,?3)').bind(activeAdmin, inactiveAdmin, employee).run()
      await database.prepare('DELETE FROM identity_principals WHERE id IN (?1,?2,?3)').bind(activeAdmin, inactiveAdmin, employee).run()
    }
  })
})
