import { Hono } from 'hono'

import { DatabaseDependencyError } from '../../../server/application/ports/database'
import { resolveTenantPrincipal } from '../../../server/application/services/resolveTenantPrincipal'
import {
  D1TenantAuthorizationAdapter,
  TenantAuthorizationError,
} from './adapters/d1TenantAuthorization'
import { D1ReadOnlyAdapter } from './adapters/d1ReadOnly'
import {
  SupabaseIdentityVerifier,
  SupabaseIdentityVerifierError,
} from './adapters/supabaseIdentityVerifier'
import { parseBearerToken } from './auth/bearerToken'
import {
  getIdentityCanaryConfiguration,
  isIdentityCanaryEnabled,
} from './auth/identityCanaryFeature'
import {
  hasCoordinationBinding,
  isEdgeCoordinationEnabled,
} from './coordination/coordinationFeature'
import {
  hasD1Binding,
  isEdgeDatabaseEnabled,
} from './databaseFeature'
import {
  FoundationWriterError,
  applyFoundationSnapshotToD1,
} from './migration/d1FoundationWriter'
import {
  FOUNDATION_MIGRATION_ROUTE,
  getFoundationMigrationConfiguration,
  isFoundationMigrationEnabled,
  verifyFoundationMigrationToken,
} from './migration/foundationMigrationFeature'
import {
  FoundationMigrationRequestError,
  readFoundationMigrationSnapshot,
} from './migration/foundationMigrationHttp'
import { emitEdgeLog } from './observability'
import { resolveRequestId, requestRouteFamily } from './requestContext'
import type { EdgeAppEnvironment } from './types'

const app = new Hono<EdgeAppEnvironment>()
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

function databaseCheckFromError(error: unknown): string {
  if (!(error instanceof DatabaseDependencyError)) return 'unavailable'
  if (error.code === 'DATABASE_TIMEOUT') return 'timeout'
  if (error.code === 'DATABASE_NOT_CONFIGURED') return 'not_configured'
  return 'unavailable'
}

function identityDependencyCode(error: unknown): string {
  if (error instanceof SupabaseIdentityVerifierError) return error.code
  if (error instanceof TenantAuthorizationError) return error.code
  return 'IDENTITY_CANARY_UNAVAILABLE'
}

function notFoundPayload(requestId: string) {
  return {
    code: 'NOT_FOUND',
    message: 'Rota não encontrada.',
    request_id: requestId,
  } as const
}

app.use('*', async (context, next) => {
  const requestId = resolveRequestId(context.req.header('x-request-id'))
  const startedAt = Date.now()

  context.set('requestId', requestId)
  context.set('startedAt', startedAt)
  context.header('x-request-id', requestId)
  context.header('cache-control', 'no-store')
  context.header('x-content-type-options', 'nosniff')
  context.header('referrer-policy', 'no-referrer')

  emitEdgeLog('info', 'edge.request.started', {
    request_id: requestId,
    method: context.req.method,
    path: requestRouteFamily(context.req.url),
    environment: context.env.APP_ENV,
  })

  try {
    await next()
  } finally {
    emitEdgeLog('info', 'edge.request.completed', {
      request_id: requestId,
      method: context.req.method,
      path: requestRouteFamily(context.req.url),
      status: context.res.status,
      duration_ms: Math.max(0, Date.now() - startedAt),
      environment: context.env.APP_ENV,
    })
  }
})

app.get('/', (context) => context.json({
  service: context.env.SERVICE_NAME,
  environment: context.env.APP_ENV,
  release_channel: context.env.RELEASE_CHANNEL,
  request_id: context.get('requestId'),
  status: 'foundation_only',
}))

app.get('/health', (context) => context.json({
  service: context.env.SERVICE_NAME,
  environment: context.env.APP_ENV,
  release_channel: context.env.RELEASE_CHANNEL,
  request_id: context.get('requestId'),
  status: 'ok',
  timestamp: new Date().toISOString(),
}))

app.get('/ready', async (context) => {
  const missingBindings = [
    ['APP_ENV', context.env.APP_ENV],
    ['SERVICE_NAME', context.env.SERVICE_NAME],
    ['RELEASE_CHANNEL', context.env.RELEASE_CHANNEL],
  ]
    .filter(([, value]) => !String(value || '').trim())
    .map(([name]) => name)

  const requestId = context.get('requestId')
  const databaseEnabled = isEdgeDatabaseEnabled(context.env.EDGE_DATABASE_ENABLED)
  let databaseCheck = 'disabled'
  let databaseLatencyMs: number | null = null
  let databaseReady = true

  if (databaseEnabled) {
    if (!hasD1Binding(context.env.DB)) {
      databaseCheck = 'not_configured'
      databaseReady = false
    } else {
      try {
        const result = await new D1ReadOnlyAdapter({
          database: context.env.DB,
        }).checkCanary({
          requestId,
          timeoutMs: 1_500,
        })

        databaseCheck = result.status
        databaseLatencyMs = result.latencyMs
        emitEdgeLog('info', 'edge.database.ready', {
          request_id: requestId,
          environment: context.env.APP_ENV,
          latency_ms: result.latencyMs,
        })
      } catch (error) {
        databaseCheck = databaseCheckFromError(error)
        databaseReady = false
        emitEdgeLog('warn', 'edge.database.not_ready', {
          request_id: requestId,
          environment: context.env.APP_ENV,
          code: error instanceof DatabaseDependencyError
            ? error.code
            : 'DATABASE_UNAVAILABLE',
        })
      }
    }
  }

  const coordinationEnabled = isEdgeCoordinationEnabled(
    context.env.EDGE_COORDINATION_ENABLED,
  )
  let coordinationCheck = 'disabled'
  let coordinationReady = true

  if (coordinationEnabled) {
    if (hasCoordinationBinding(context.env.COORDINATOR)) {
      coordinationCheck = 'ready'
    } else {
      coordinationCheck = 'not_configured'
      coordinationReady = false
      emitEdgeLog('warn', 'edge.coordination.not_ready', {
        request_id: requestId,
        environment: context.env.APP_ENV,
        code: 'COORDINATION_BINDING_UNAVAILABLE',
      })
    }
  }

  const identityCanaryEnabled = isIdentityCanaryEnabled(
    context.env.EDGE_IDENTITY_CANARY_ENABLED,
  )
  let identityCanaryCheck = 'disabled'
  let identityCanaryReady = true
  let identityCanaryMissing: readonly string[] = []

  if (identityCanaryEnabled) {
    const identityConfiguration = getIdentityCanaryConfiguration(context.env)
    identityCanaryReady = identityConfiguration.ready
    identityCanaryMissing = identityConfiguration.missing
    identityCanaryCheck = identityCanaryReady ? 'configured' : 'not_configured'

    if (!identityCanaryReady) {
      emitEdgeLog('warn', 'edge.identity_canary.not_ready', {
        request_id: requestId,
        environment: context.env.APP_ENV,
        missing_count: identityCanaryMissing.length,
      })
    }
  }

  const foundationMigrationEnabled = isFoundationMigrationEnabled(
    context.env.EDGE_FOUNDATION_MIGRATION_ENABLED,
  )
  let foundationMigrationCheck = 'disabled'
  let foundationMigrationReady = true
  let foundationMigrationMissing: readonly string[] = []

  if (foundationMigrationEnabled) {
    const migrationConfiguration = getFoundationMigrationConfiguration(context.env)
    foundationMigrationReady = migrationConfiguration.ready
    foundationMigrationMissing = migrationConfiguration.missing
    foundationMigrationCheck = migrationConfiguration.wrongEnvironment
      ? 'wrong_environment'
      : migrationConfiguration.ready ? 'configured' : 'not_configured'

    if (!foundationMigrationReady) {
      emitEdgeLog('warn', 'edge.foundation_migration.not_ready', {
        request_id: requestId,
        environment: context.env.APP_ENV,
        wrong_environment: migrationConfiguration.wrongEnvironment,
        missing_count: foundationMigrationMissing.length,
      })
    }
  }

  const allMissingBindings = Array.from(new Set([
    ...missingBindings,
    ...identityCanaryMissing,
    ...foundationMigrationMissing,
  ]))

  const isReady = missingBindings.length === 0
    && databaseReady
    && coordinationReady
    && identityCanaryReady
    && foundationMigrationReady

  const payload = {
    service: context.env.SERVICE_NAME,
    environment: context.env.APP_ENV,
    release_channel: context.env.RELEASE_CHANNEL,
    request_id: requestId,
    status: isReady ? 'ready' : 'not_ready',
    checks: {
      configuration: missingBindings.length ? 'failed' : 'ok',
      database: databaseCheck,
      coordination: coordinationCheck,
      identity_canary: identityCanaryCheck,
      foundation_migration: foundationMigrationCheck,
    },
    database_latency_ms: databaseLatencyMs,
    missing_bindings: allMissingBindings,
    timestamp: new Date().toISOString(),
  }

  return isReady
    ? context.json(payload, 200)
    : context.json(payload, 503)
})

app.get('/internal/canary/tenant-context', async (context) => {
  const requestId = context.get('requestId')

  if (!isIdentityCanaryEnabled(context.env.EDGE_IDENTITY_CANARY_ENABLED)) {
    return context.json(notFoundPayload(requestId), 404)
  }

  const identityConfiguration = getIdentityCanaryConfiguration(context.env)
  if (!identityConfiguration.ready) {
    emitEdgeLog('warn', 'edge.identity_canary.not_configured', {
      request_id: requestId,
      environment: context.env.APP_ENV,
      missing_count: identityConfiguration.missing.length,
    })

    return context.json({
      code: 'IDENTITY_CANARY_UNAVAILABLE',
      message: 'Canário de identidade indisponível.',
      request_id: requestId,
    }, 503)
  }

  const bearer = parseBearerToken(context.req.header('authorization'))
  if (bearer.kind !== 'token') {
    return context.json({
      code: 'UNAUTHENTICATED',
      message: 'Autenticação necessária.',
      request_id: requestId,
    }, 401)
  }

  const tenantId = String(context.req.header('x-tenant-id') || '').trim()
  if (!tenantId) {
    return context.json({
      code: 'TENANT_REQUIRED',
      message: 'Tenant necessário.',
      request_id: requestId,
    }, 400)
  }

  try {
    const resolution = await resolveTenantPrincipal(
      bearer.token,
      tenantId,
      {
        identityVerification: new SupabaseIdentityVerifier({
          supabaseUrl: context.env.SUPABASE_URL || '',
          publishableKey: context.env.SUPABASE_PUBLISHABLE_KEY || '',
        }),
        tenantAuthorization: new D1TenantAuthorizationAdapter(context.env.DB),
      },
    )

    if (resolution.kind === 'unauthenticated') {
      return context.json({
        code: 'UNAUTHENTICATED',
        message: 'Autenticação necessária.',
        request_id: requestId,
      }, 401)
    }

    if (resolution.kind === 'forbidden') {
      return context.json({
        code: 'FORBIDDEN',
        message: 'Acesso ao tenant negado.',
        request_id: requestId,
      }, 403)
    }

    emitEdgeLog('info', 'edge.identity_canary.resolved', {
      request_id: requestId,
      environment: context.env.APP_ENV,
      identity_provider: resolution.context.identity.provider,
    })

    return context.json({
      status: 'ok',
      request_id: requestId,
      tenant_id: resolution.context.tenantId,
      principal_id: resolution.context.principalId,
      identity_provider: resolution.context.identity.provider,
    }, 200)
  } catch (error) {
    if (error instanceof TenantAuthorizationError && error.code === 'INVALID_ARGUMENT') {
      return context.json({
        code: 'INVALID_TENANT',
        message: 'Tenant inválido.',
        request_id: requestId,
      }, 400)
    }

    emitEdgeLog('warn', 'edge.identity_canary.unavailable', {
      request_id: requestId,
      environment: context.env.APP_ENV,
      code: identityDependencyCode(error),
    })

    return context.json({
      code: 'IDENTITY_CANARY_UNAVAILABLE',
      message: 'Canário de identidade indisponível.',
      request_id: requestId,
    }, 503)
  }
})

app.post(FOUNDATION_MIGRATION_ROUTE, async (context) => {
  const requestId = context.get('requestId')
  const enabled = isFoundationMigrationEnabled(
    context.env.EDGE_FOUNDATION_MIGRATION_ENABLED,
  )
  const isStaging = String(context.env.APP_ENV || '').trim().toLowerCase() === 'staging'

  if (!enabled || !isStaging) {
    return context.json(notFoundPayload(requestId), 404)
  }

  const configuration = getFoundationMigrationConfiguration(context.env)
  if (!configuration.ready) {
    emitEdgeLog('warn', 'edge.foundation_migration.not_configured', {
      request_id: requestId,
      environment: context.env.APP_ENV,
      missing_count: configuration.missing.length,
    })
    return context.json({
      code: 'FOUNDATION_MIGRATION_UNAVAILABLE',
      message: 'Migração de foundation indisponível.',
      request_id: requestId,
    }, 503)
  }

  const tokenAccepted = await verifyFoundationMigrationToken(
    context.req.header('x-yuisync-migration-token'),
    context.env.FOUNDATION_MIGRATION_TOKEN,
  )
  if (!tokenAccepted) {
    emitEdgeLog('warn', 'edge.foundation_migration.unauthorized', {
      request_id: requestId,
      environment: context.env.APP_ENV,
    })
    return context.json({
      code: 'UNAUTHORIZED',
      message: 'Autorização de migração inválida.',
      request_id: requestId,
    }, 401)
  }

  const declaredSnapshotSha256 = String(
    context.req.header('x-yuisync-migration-snapshot-sha256') || '',
  ).trim().toLowerCase()
  if (!SHA256_HEX_PATTERN.test(declaredSnapshotSha256)) {
    return context.json({
      code: 'SNAPSHOT_CHECKSUM_REQUIRED',
      message: 'Checksum do snapshot é obrigatório.',
      request_id: requestId,
    }, 400)
  }

  let snapshot: unknown
  try {
    const requestBody = await readFoundationMigrationSnapshot(context.req.raw)
    if (requestBody.sha256 !== declaredSnapshotSha256) {
      return context.json({
        code: 'SNAPSHOT_CHECKSUM_MISMATCH',
        message: 'Checksum do snapshot não confere.',
        request_id: requestId,
      }, 409)
    }
    snapshot = requestBody.snapshot
  } catch (error) {
    if (error instanceof FoundationMigrationRequestError) {
      return context.json({
        code: error.code,
        message: 'Requisição de migração inválida.',
        request_id: requestId,
      }, error.status)
    }
    throw error
  }

  try {
    const result = await applyFoundationSnapshotToD1({
      database: context.env.DB,
      snapshot,
      nowMs: Date.now(),
    })

    emitEdgeLog('info', 'edge.foundation_migration.applied', {
      request_id: requestId,
      environment: context.env.APP_ENV,
      identity_count: result.identityCount,
      membership_count: result.membershipCount,
      settings_present: result.settingsPresent,
      statement_count: result.statementCount,
    })

    return context.json({
      status: result.status,
      request_id: requestId,
      identity_count: result.identityCount,
      membership_count: result.membershipCount,
      settings_present: result.settingsPresent,
      statement_count: result.statementCount,
    }, 200)
  } catch (error) {
    if (error instanceof FoundationWriterError) {
      const status: 400 | 409 | 413 | 503 = error.code === 'INVALID_SNAPSHOT'
        ? 400
        : error.code === 'SNAPSHOT_TOO_LARGE'
          ? 413
          : error.code === 'FOUNDATION_WRITE_REJECTED'
            ? 409
            : 503

      emitEdgeLog('warn', 'edge.foundation_migration.rejected', {
        request_id: requestId,
        environment: context.env.APP_ENV,
        code: error.code,
      })

      return context.json({
        code: error.code,
        message: 'Migração de foundation rejeitada.',
        request_id: requestId,
      }, status)
    }
    throw error
  }
})

app.notFound((context) => context.json(
  notFoundPayload(context.get('requestId')),
  404,
))

app.onError((error, context) => {
  emitEdgeLog('error', 'edge.request.failed', {
    request_id: context.get('requestId') || 'unavailable',
    method: context.req.method,
    path: requestRouteFamily(context.req.url),
    error_name: error.name || 'Error',
    environment: context.env.APP_ENV,
  })

  return context.json({
    code: 'INTERNAL_ERROR',
    message: 'Falha interna ao processar a requisição.',
    request_id: context.get('requestId') || null,
  }, 500)
})

export default app
