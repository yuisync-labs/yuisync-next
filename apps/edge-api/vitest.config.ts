import { fileURLToPath } from 'node:url'

import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url))
const authMigrationsPath = fileURLToPath(new URL('./auth-migrations', import.meta.url))

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: {
        configPath: './wrangler.test.jsonc',
      },
      miniflare: {
        d1Databases: ['DB', 'AUTH_DB'],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
          TEST_AUTH_MIGRATIONS: await readD1Migrations(authMigrationsPath),
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/applyD1Migrations.ts'],
    clearMocks: true,
  },
})
