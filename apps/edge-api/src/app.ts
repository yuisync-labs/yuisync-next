import { Hono } from 'hono'

import { DatabaseDependencyError } from '../../../server/application/ports/database'
import { D1ReadOnlyAdapter } from './adapters/d1ReadOnly'
import {
  hasD1Binding,
  isEdgeDatabaseEnabled,
} from './databaseFeature'
import { emitEdgeLog } from './observability'
import { resolveRequestId } from './requestContext'
import type { EdgeAppEnvironment } from './types'

const app = new Hono<EdgeAppEnvironment>()

function databaseCheckFromError(error: unknown): string {
  if (!(error instanceof DatabaseDependencyError)) return 'unavailable'
  if (error.code === 'DATABASE_TIMEOUT') return 'timeout'
  if (error.code === 'DATABASE_NOT_CONFIGURED') return 'not_configured'
  return 'unavailable'
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
    path: context.req.path,
    environment: context.env.APP_ENV,
  })

  try {
    await next()
  } finally {
    emitEdgeLog('info', 'edge.request.completed', {
      request_id: requestId,
      method: context.req.method,
      path: context.req.path,
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

  const isReady = missingBindings.length === 0 && databaseReady
  const payload = {
    service: context.env.SERVICE_NAME,
    environment: context.env.APP_ENV,
    release_channel: context.env.RELEASE_CHANNEL,
    request_id: requestId,
    status: isReady ? 'ready' : 'not_ready',
    checks: {
      configuration: missingBindings.length ? 'failed' : 'ok',
      database: databaseCheck,
    },
    database_latency_ms: databaseLatencyMs,
    missing_bindings: missingBindings,
    timestamp: new Date().toISOString(),
  }

  return isReady
    ? context.json(payload, 200)
    : context.json(payload, 503)
})

app.notFound((context) => context.json({
  code: 'NOT_FOUND',
  message: 'Rota não encontrada.',
  request_id: context.get('requestId'),
}, 404))

app.onError((error, context) => {
  emitEdgeLog('error', 'edge.request.failed', {
    request_id: context.get('requestId') || 'unavailable',
    method: context.req.method,
    path: context.req.path,
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
