import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.PLAYWRIGHT_CHROME_PATH || undefined

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /legacy-regression-p0\.spec\.js/,
  timeout: 75_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line'], ['html', { outputFolder: 'playwright-report/legacy-regression', open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
