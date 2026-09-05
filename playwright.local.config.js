import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/agenda-drag-semantic.spec.js',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3082', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3082 --strictPort',
    url: 'http://127.0.0.1:3082', reuseExistingServer: false, timeout: 120000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
})
