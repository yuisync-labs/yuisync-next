import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  FoundationStagingOrchestratorError,
  buildStagingRestoreCommand,
  createFoundationStagingPoster,
  createStagingTimeTravelBookmarkCapture,
  orchestrateFoundationStagingMigration,
  parseTimeTravelBookmarkJson,
} from '../scripts/migration/foundationStagingOrchestrator.mjs'

const TENANT_ID = 'tenant-orchestrator'
const TOKEN = 'foundation-orchestrator-token-123456789012345'
const STAGING_URL = 'https://yuisync-next-staging.example.workers.dev'
const BOOKMARK = 'bookmark-test-2026-08-07T17:00:00Z'
const RUN_ID = 'foundation-20260807T170000Z-testfixture'

function sourceSnapshot(storeName = 'Quatro Patas') {
  const subject = `auth-${TENANT_ID}`
  return {
    projection: { name: 'phase7-foundation', version: 1 },
    source: { system: 'supabase', snapshot_id: 'source-orchestrator-fixture' },
    scope: { tenant_id: TENANT_ID, module_id: 'petshop' },
    collections: {
      tenants: [
        {
          key: `tenant:${TENANT_ID}`,
          data: {
            id: TENANT_ID,
            slug: TENANT_ID,
            name: 'Quatro Patas',
            status: 'active',
          },
        },
      ],
      identity_principals: [
        {
          key: `identity:supabase:${subject}`,
          data: {
            provider: 'supabase',
            subject,
            display_name: 'Operador',
            email: `${TENANT_ID}@example.com`,
            status: 'active',
          },
        },
      ],
      tenant_memberships: [
        {
          key: `membership:${TENANT_ID}:supabase:${subject}`,
          data: {
            tenant_id: TENANT_ID,
            provider: 'supabase',
            subject,
            status: 'active',
          },
        },
      ],
      tenant_module_settings: [
        {
          key: `settings:${TENANT_ID}:petshop`,
          data: {
            tenant_id: TENANT_ID,
            module_id: 'petshop',
            store_name: storeName,
            store_phone: '32999990000',
            store_address: 'Av. Central, 123',
            store_neighborhood: 'Centro',
            store_city: 'Muriaé',
            bot_prompt: 'Atenda com clareza.',
          },
        },
      ],
    },
  }
}

function destinationSnapshot(storeName = 'Quatro Patas') {
  const snapshot = structuredClone(sourceSnapshot(storeName))
  snapshot.source = {
    system: 'd1',
    snapshot_id: 'd1-orchestrator-fixture',
  }
  return snapshot
}

function bytes(value = sourceSnapshot()) {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function confirmations() {
  return {
    tenantId: TENANT_ID,
    projection: 'phase7-foundation/v1',
  }
}

function artifactRecorder(order = []) {
  const artifacts = new Map()
  return {
    artifacts,
    async writeArtifact(name, value) {
      order.push(`artifact:${name}`)
      if (artifacts.has(name)) throw new Error('duplicate artifact')
      artifacts.set(name, structuredClone(value))
    },
  }
}

describe('foundation staging orchestrator', () => {
  it('executa bookmark -> POST -> extract -> reconcile e termina in_sync', async () => {
    const order = []
    const recorder = artifactRecorder(order)
    const snapshotBytes = bytes()
    const expectedSha = createHash('sha256').update(snapshotBytes).digest('hex')

    const result = await orchestrateFoundationStagingMigration({
      snapshotBytes,
      confirmations: confirmations(),
      stagingBaseUrl: STAGING_URL,
      migrationToken: TOKEN,
      sourcePathLabel: '.migration/source.snapshot.json',
      dependencies: {
        runId: RUN_ID,
        writeArtifact: recorder.writeArtifact,
        captureBookmark: async () => {
          order.push('bookmark')
          return BOOKMARK
        },
        postSnapshot: async (input) => {
          order.push('post')
          expect(input.baseUrl).toBe(`${STAGING_URL}/`)
          expect(input.migrationToken).toBe(TOKEN)
          expect(Buffer.from(input.snapshotBytes)).toEqual(snapshotBytes)
          expect(input.snapshotSha256).toBe(expectedSha)
          expect(input.runId).toBe(RUN_ID)
          return {
            status: 'applied_or_already_present',
            request_id: RUN_ID,
            identity_count: 1,
            membership_count: 1,
            settings_present: true,
            statement_count: 9,
          }
        },
        extractDestination: async ({ snapshotId, scope }) => {
          order.push('extract')
          expect(snapshotId).toBe(`d1-staging-after-${RUN_ID}`)
          expect(scope).toEqual({ tenant_id: TENANT_ID, module_id: 'petshop' })
          return destinationSnapshot()
        },
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('in_sync')
    expect(result.prewrite_bookmark).toBe(BOOKMARK)
    expect(result.restore_command).toContain('time-travel')
    expect(result.restore_command).toContain('restore')
    expect(result.restore_command).toContain('staging')
    expect(result.restore_command).toContain(BOOKMARK)
    expect(result.reconciliation.in_sync).toBe(true)

    expect(order).toEqual([
      'artifact:source.manifest.json',
      'bookmark',
      'artifact:plan.json',
      'post',
      'artifact:transport.json',
      'extract',
      'artifact:destination.snapshot.json',
      'artifact:destination.manifest.json',
      'artifact:reconciliation.json',
      'artifact:result.json',
    ])

    expect(recorder.artifacts.get('plan.json')).toMatchObject({
      run_id: RUN_ID,
      environment: 'staging',
      source_snapshot: '.migration/source.snapshot.json',
      snapshot_sha256: expectedSha,
      prewrite_bookmark: BOOKMARK,
      scope: { tenant_id: TENANT_ID, module_id: 'petshop' },
    })
    expect(JSON.stringify(recorder.artifacts)).not.toContain(TOKEN)
  })

  it('retorna exit code 2 em divergência e nunca executa restore', async () => {
    const order = []
    const recorder = artifactRecorder(order)
    const restoreSpy = vi.fn()

    const result = await orchestrateFoundationStagingMigration({
      snapshotBytes: bytes(),
      confirmations: confirmations(),
      stagingBaseUrl: STAGING_URL,
      migrationToken: TOKEN,
      sourcePathLabel: '.migration/source.snapshot.json',
      dependencies: {
        runId: RUN_ID,
        writeArtifact: recorder.writeArtifact,
        captureBookmark: async () => BOOKMARK,
        postSnapshot: async () => ({
          status: 'applied_or_already_present',
          request_id: RUN_ID,
          identity_count: 1,
          membership_count: 1,
          settings_present: true,
          statement_count: 9,
        }),
        extractDestination: async () => destinationSnapshot('Nome divergente'),
        restore: restoreSpy,
      },
    })

    expect(result.exitCode).toBe(2)
    expect(result.status).toBe('diverged')
    expect(result.reconciliation.in_sync).toBe(false)
    expect(result.restore_command).toContain(BOOKMARK)
    expect(restoreSpy).not.toHaveBeenCalled()
    expect(recorder.artifacts.get('result.json')).toMatchObject({
      status: 'diverged',
      prewrite_bookmark: BOOKMARK,
    })
  })

  it('falha antes do bookmark quando confirmação de tenant não corresponde', async () => {
    const recorder = artifactRecorder()
    const captureBookmark = vi.fn()
    const postSnapshot = vi.fn()

    await expect(orchestrateFoundationStagingMigration({
      snapshotBytes: bytes(),
      confirmations: {
        tenantId: 'tenant-errado',
        projection: 'phase7-foundation/v1',
      },
      stagingBaseUrl: STAGING_URL,
      migrationToken: TOKEN,
      sourcePathLabel: '.migration/source.snapshot.json',
      dependencies: {
        runId: RUN_ID,
        writeArtifact: recorder.writeArtifact,
        captureBookmark,
        postSnapshot,
      },
    })).rejects.toMatchObject({
      code: 'TENANT_CONFIRMATION_MISMATCH',
      rollbackBookmark: null,
    })

    expect(captureBookmark).not.toHaveBeenCalled()
    expect(postSnapshot).not.toHaveBeenCalled()
    expect(recorder.artifacts.size).toBe(0)
  })

  it('preserva bookmark em falha ambígua de transporte e registra recovery', async () => {
    const recorder = artifactRecorder()

    let error
    try {
      await orchestrateFoundationStagingMigration({
        snapshotBytes: bytes(),
        confirmations: confirmations(),
        stagingBaseUrl: STAGING_URL,
        migrationToken: TOKEN,
        sourcePathLabel: '.migration/source.snapshot.json',
        dependencies: {
          runId: RUN_ID,
          writeArtifact: recorder.writeArtifact,
          captureBookmark: async () => BOOKMARK,
          postSnapshot: async () => {
            throw new FoundationStagingOrchestratorError('STAGING_TRANSPORT_UNAVAILABLE')
          },
          extractDestination: vi.fn(),
        },
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(FoundationStagingOrchestratorError)
    expect(error).toMatchObject({
      code: 'STAGING_TRANSPORT_UNAVAILABLE',
      rollbackBookmark: BOOKMARK,
    })
    expect(recorder.artifacts.get('failure.json')).toMatchObject({
      status: 'failed',
      code: 'STAGING_TRANSPORT_UNAVAILABLE',
      prewrite_bookmark: BOOKMARK,
    })
    expect(recorder.artifacts.get('failure.json').restore_command).toContain(BOOKMARK)
  })

  it('preserva bookmark mesmo se o artifact writer falhar ao registrar failure.json', async () => {
    const writes = []
    const writeArtifact = async (name) => {
      writes.push(name)
      if (name === 'failure.json') throw new Error('disk full')
    }

    await expect(orchestrateFoundationStagingMigration({
      snapshotBytes: bytes(),
      confirmations: confirmations(),
      stagingBaseUrl: STAGING_URL,
      migrationToken: TOKEN,
      sourcePathLabel: '.migration/source.snapshot.json',
      dependencies: {
        runId: RUN_ID,
        writeArtifact,
        captureBookmark: async () => BOOKMARK,
        postSnapshot: async () => {
          throw new FoundationStagingOrchestratorError('STAGING_TRANSPORT_UNAVAILABLE')
        },
      },
    })).rejects.toMatchObject({
      code: 'STAGING_TRANSPORT_UNAVAILABLE',
      rollbackBookmark: BOOKMARK,
    })

    expect(writes).toContain('failure.json')
  })

  it('recusa execução programática sem artifact writer obrigatório', async () => {
    await expect(orchestrateFoundationStagingMigration({
      snapshotBytes: bytes(),
      confirmations: confirmations(),
      stagingBaseUrl: STAGING_URL,
      migrationToken: TOKEN,
      sourcePathLabel: '.migration/source.snapshot.json',
      dependencies: {
        captureBookmark: vi.fn(),
        postSnapshot: vi.fn(),
      },
    })).rejects.toMatchObject({ code: 'ARTIFACT_WRITER_REQUIRED' })
  })

  it('recusa source path label fora de .migration', async () => {
    await expect(orchestrateFoundationStagingMigration({
      snapshotBytes: bytes(),
      confirmations: confirmations(),
      stagingBaseUrl: STAGING_URL,
      migrationToken: TOKEN,
      sourcePathLabel: '../source.snapshot.json',
      dependencies: {
        writeArtifact: vi.fn(),
      },
    })).rejects.toMatchObject({ code: 'SOURCE_PATH_LABEL_INVALID' })
  })
})

describe('staging Time Travel and transport helpers', () => {
  it('parseia bookmark direto, envelopado e em array de um item', () => {
    expect(parseTimeTravelBookmarkJson(JSON.stringify({ bookmark: BOOKMARK }))).toBe(BOOKMARK)
    expect(parseTimeTravelBookmarkJson(JSON.stringify({ result: { bookmark: BOOKMARK } }))).toBe(BOOKMARK)
    expect(parseTimeTravelBookmarkJson(JSON.stringify([{ bookmark: BOOKMARK }]))).toBe(BOOKMARK)
  })

  it('rejeita bookmark com caracteres de shell ou resposta ambígua', () => {
    expect(() => parseTimeTravelBookmarkJson(JSON.stringify({
      bookmark: 'bookmark; rm -rf /',
    }))).toThrowError(expect.objectContaining({ code: 'TIME_TRAVEL_BOOKMARK_INVALID' }))

    expect(() => parseTimeTravelBookmarkJson(JSON.stringify([
      { bookmark: BOOKMARK },
      { bookmark: 'another' },
    ]))).toThrowError(expect.objectContaining({ code: 'TIME_TRAVEL_BOOKMARK_INVALID' }))
  })

  it('captura Time Travel somente de DB staging e nunca executa restore', async () => {
    const calls = []
    const execFile = vi.fn(async (command, args, options) => {
      calls.push({ command, args, options })
      return {
        stdout: JSON.stringify({ bookmark: BOOKMARK }),
        stderr: '',
      }
    })

    const capture = createStagingTimeTravelBookmarkCapture({ execFile })
    await expect(capture()).resolves.toBe(BOOKMARK)

    expect(calls).toHaveLength(1)
    const [{ args }] = calls
    expect(args).toContain('time-travel')
    expect(args).toContain('info')
    expect(args).toContain('DB')
    expect(args.slice(args.indexOf('--env'), args.indexOf('--env') + 2)).toEqual([
      '--env', 'staging',
    ])
    expect(args).toContain('--json')
    expect(args).not.toContain('restore')
    expect(args).not.toContain('production')
  })

  it('gera restore command somente como texto staging/DB', () => {
    const command = buildStagingRestoreCommand(BOOKMARK)
    expect(command).toContain('time-travel')
    expect(command).toContain('restore')
    expect(command).toContain('DB')
    expect(command).toContain('staging')
    expect(command).toContain(BOOKMARK)
    expect(command).not.toContain('production')
  })

  it('poster envia bytes exatos, checksum, token e request ID para a rota fixa', async () => {
    const snapshotBytes = bytes()
    const checksum = createHash('sha256').update(snapshotBytes).digest('hex')
    const calls = []
    const fetcher = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init })
      return Response.json({
        status: 'applied_or_already_present',
        request_id: RUN_ID,
        identity_count: 1,
        membership_count: 1,
        settings_present: true,
        statement_count: 9,
      })
    })

    const post = createFoundationStagingPoster({ fetcher })
    await expect(post({
      baseUrl: STAGING_URL,
      migrationToken: TOKEN,
      snapshotBytes,
      snapshotSha256: checksum,
      runId: RUN_ID,
    })).resolves.toMatchObject({
      status: 'applied_or_already_present',
      request_id: RUN_ID,
    })

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.url).toBe(`${STAGING_URL}/internal/migration/foundation`)
    expect(call.init.method).toBe('POST')
    expect(call.init.redirect).toBe('error')
    expect(call.init.headers['x-yuisync-migration-token']).toBe(TOKEN)
    expect(call.init.headers['x-yuisync-migration-snapshot-sha256']).toBe(checksum)
    expect(call.init.headers['x-request-id']).toBe(RUN_ID)
    expect(Buffer.from(call.init.body)).toEqual(snapshotBytes)
  })

  it('poster sanitiza rejection do staging e não inclui token na mensagem', async () => {
    const fetcher = vi.fn(async () => Response.json(
      { code: 'FOUNDATION_WRITE_REJECTED', message: `secret=${TOKEN}` },
      { status: 409 },
    ))
    const post = createFoundationStagingPoster({ fetcher })

    let error
    try {
      await post({
        baseUrl: STAGING_URL,
        migrationToken: TOKEN,
        snapshotBytes: bytes(),
        snapshotSha256: '0'.repeat(64),
        runId: RUN_ID,
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(FoundationStagingOrchestratorError)
    expect(error).toMatchObject({
      code: 'STAGING_WRITE_REJECTED',
      causeCode: 'FOUNDATION_WRITE_REJECTED',
    })
    expect(error.message).not.toContain(TOKEN)
  })

  it('poster recusa URL não HTTPS antes de qualquer fetch', async () => {
    const fetcher = vi.fn()
    const post = createFoundationStagingPoster({ fetcher })

    await expect(post({
      baseUrl: 'http://staging.example.test',
      migrationToken: TOKEN,
      snapshotBytes: bytes(),
      snapshotSha256: '0'.repeat(64),
      runId: RUN_ID,
    })).rejects.toMatchObject({ code: 'STAGING_URL_INVALID' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
