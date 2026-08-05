import { Hono } from 'hono'

import { emitEdgeLog } from './observability'
import { resolveRequestId } from './requestContext'
import type { EdgeAppEnvironment } from './types'

const app = new Hono<EdgeAppEnvironment>()

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

app.get('/ready', (context) => {
  const missingBindings = [
    ['APP_ENV', context.env.APP_ENV],
    ['SERVICE_NAME', context.env.SERVICE_NAME],
    ['RELEASE_CHANNEL', context.env.RELEASE_CHANNEL],
  ]
    .filter(([, value]) => !String(value || '').trim())
    .map(([name]) => name)

  const payload = {
    service: context.env.SERVICE_NAME,
    environment: context.env.APP_ENV,
    release_channel: context.env.RELEASE_CHANNEL,
    request_id: context.get('requestId'),
    status: missingBindings.length ? 'not_ready' : 'ready',
    checks: {
      configuration: missingBindings.length ? 'failed' : 'ok',
    },
    missing_bindings: missingBindings,
    timestamp: new Date().toISOString(),
  }

  return missingBindings.length
    ? context.json(payload, 503)
    : context.json(payload, 200)
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
