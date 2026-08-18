import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const canonicalProductionWorkflows = [
  '.github/workflows/production-final-deploy-v2.yml',
  '.github/workflows/production-rollback.yml',
]

describe('production GitHub Environment boundary', () => {
  for (const workflow of canonicalProductionWorkflows) {
    it(`${workflow} is isolated from the staging environment`, async () => {
      const source = await readFile(workflow, 'utf8')
      expect(source).toContain('environment: cloudflare-production')
      expect(source).not.toContain('environment: cloudflare-staging')
    })
  }

  it('keeps the real staging certification on cloudflare-staging', async () => {
    const source = await readFile('.github/workflows/full-staging-certification.yml', 'utf8')
    expect(source).toContain('environment: cloudflare-staging')
    expect(source).not.toContain('environment: cloudflare-production')
  })
})
