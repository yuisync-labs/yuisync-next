import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('release certification workflow', () => {
  it('keeps pull-request browser checks local and deterministic', async () => {
    const source = await readFile('.github/workflows/quality.yml', 'utf8')
    expect(source).toContain('Local public browser smoke')
    expect(source).toContain('Local agenda drag regression')
    expect(source).toContain('E2E_PUBLIC_SMOKE_LOCAL')
    expect(source).toContain('test/e2e/public-smoke.spec.js')
    expect(source).not.toContain('secrets.E2E_BASE_URL')
    expect(source).not.toContain('secrets.TENANT_A_EMAIL')
  })

  it('runs hosted browser and tenant isolation against disposable staging identities', async () => {
    const workflow = await readFile('.github/workflows/full-staging-certification.yml', 'utf8')
    const fixture = await readFile('scripts/migration/staging-e2e-fixtures.mjs', 'utf8')

    expect(workflow).toContain('Prepare ephemeral Better Auth browser users')
    expect(workflow).toContain('Prove tenant isolation with disposable tenants')
    expect(workflow).toContain('npm run test:tenant')
    expect(workflow).toContain('Clean ephemeral Better Auth browser users')
    expect(fixture).toContain('TENANT_A_EMAIL')
    expect(fixture).toContain('TENANT_B_EMAIL')
    expect(fixture).toContain('isolationTenantId')
  })
})
