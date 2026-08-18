import { env } from 'cloudflare:workers'
import { describe, it } from 'vitest'

import { runColdUpgradeV25 } from './d1ColdUpgradeV25Harness'

type TestEnv = EdgeEnv & {
  DB: D1Database
  TEST_MIGRATIONS: Parameters<typeof import('cloudflare:test').applyD1Migrations>[1]
}

const testEnv = env as TestEnv

describe('D1 cold upgrade proof 1/2', () => {
  it('upgrades an isolated v25 snapshot to v30', async () => {
    await runColdUpgradeV25(testEnv.DB, testEnv.TEST_MIGRATIONS)
  })
})
