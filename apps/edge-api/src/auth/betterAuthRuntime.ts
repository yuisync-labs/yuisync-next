import { betterAuth } from 'better-auth'
import { compare, hash } from 'bcryptjs'

import {
  getAuthDatabaseReadiness,
  requireAuthDatabase,
  type AuthDatabaseBindings,
} from './authDatabaseFeature'

const BCRYPT_ROUNDS = 12
const BCRYPT_MAX_BYTES = 72

export type BetterAuthRuntimeBindings = AuthDatabaseBindings & {
  EDGE_AUTH_TRUSTED_ORIGINS?: string
}

function assertBcryptPassword(password: string): void {
  if (new TextEncoder().encode(password).byteLength > BCRYPT_MAX_BYTES) {
    throw new Error('Password exceeds the bcrypt compatibility limit.')
  }
}

function trustedOrigins(bindings: BetterAuthRuntimeBindings, requestOrigin: string): string[] {
  const configured = String(bindings.EDGE_AUTH_TRUSTED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return [...new Set([requestOrigin, ...configured])]
}

export function createBetterAuthRuntime(
  bindings: BetterAuthRuntimeBindings,
  requestOrigin: string,
) {
  const database = requireAuthDatabase(bindings)
  const secret = String(bindings.BETTER_AUTH_SECRET || '')

  return betterAuth({
    database,
    secret,
    baseURL: requestOrigin,
    basePath: '/api/auth',
    trustedOrigins: trustedOrigins(bindings, requestOrigin),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      maxPasswordLength: BCRYPT_MAX_BYTES,
      password: {
        hash: async (password) => {
          assertBcryptPassword(password)
          return hash(password, BCRYPT_ROUNDS)
        },
        verify: async ({ hash: storedHash, password }) => {
          assertBcryptPassword(password)
          return compare(password, storedHash)
        },
      },
    },
    advanced: {
      database: {
        generateId: 'uuid',
      },
    },
  })
}

export function isBetterAuthRuntimeEnabled(bindings: BetterAuthRuntimeBindings): boolean {
  return String(bindings.EDGE_BETTER_AUTH_ENABLED || '') === 'true'
}

export async function handleBetterAuthRequest(
  request: Request,
  bindings: BetterAuthRuntimeBindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/auth/')) return null
  if (!isBetterAuthRuntimeEnabled(bindings)) return new Response('Not Found', { status: 404 })
  if (getAuthDatabaseReadiness(bindings) !== 'configured') {
    return Response.json({ code: 'AUTH_NOT_CONFIGURED' }, { status: 503 })
  }

  const allowedOrigins = trustedOrigins(bindings, url.origin)
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.includes(origin)) return new Response(null, { status: 403 })
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,x-tenant-id,x-request-id',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        vary: 'Origin',
      },
    })
  }

  const auth = createBetterAuthRuntime(bindings, url.origin)
  const response = await auth.handler(request)
  if (origin && allowedOrigins.includes(origin)) {
    const headers = new Headers(response.headers)
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.append('vary', 'Origin')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
  return response
}

export async function getBetterAuthSession(request: Request, bindings: BetterAuthRuntimeBindings) {
  if (!isBetterAuthRuntimeEnabled(bindings) || getAuthDatabaseReadiness(bindings) !== 'configured') return null
  const auth = createBetterAuthRuntime(bindings, new URL(request.url).origin)
  return auth.api.getSession({ headers: request.headers })
}
