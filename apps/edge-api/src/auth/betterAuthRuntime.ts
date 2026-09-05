import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { compare, hash } from 'bcryptjs'
import { recoveryEmailConfigured, sendPasswordRecoveryEmail, type RecoveryEmailBindings } from './passwordRecoveryEmail'

import {
  getAuthDatabaseReadiness,
  requireAuthDatabase,
  type AuthDatabaseBindings,
} from './authDatabaseFeature'

const BCRYPT_ROUNDS = 12
const BCRYPT_MAX_BYTES = 72
const AUTH_DIAGNOSTIC_HEADER = 'x-yuisync-auth-diagnostic'

export type BetterAuthRuntimeBindings = AuthDatabaseBindings & RecoveryEmailBindings & {
  EDGE_AUTH_TRUSTED_ORIGINS?: string
  APP_ENV?: string
}

type AuthDiagnosticSink = { code?: string }
type MigrationOptions = Parameters<typeof getMigrations>[0]

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

function diagnosticText(error: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 4 || error == null) return ''
  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') return String(error)
  if (typeof error !== 'object') return ''
  if (seen.has(error)) return ''
  seen.add(error)

  if (error instanceof Error) {
    const record = error as Error & Record<string, unknown>
    return [error.name, record.code, record.status, record.statusCode, error.message, record.cause]
      .map((value) => diagnosticText(value, depth + 1, seen))
      .filter(Boolean)
      .join(' | ')
  }

  return Object.values(error as Record<string, unknown>)
    .slice(0, 24)
    .map((value) => diagnosticText(value, depth + 1, seen))
    .filter(Boolean)
    .join(' | ')
}

function safeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'unknown'
}

function classifyAuthError(error: unknown): string {
  const text = diagnosticText(error)
  const lower = text.toLowerCase()
  const match = (pattern: RegExp) => pattern.exec(text)?.[1]

  const missingTable = match(/no such table:\s*([A-Za-z0-9_.-]+)/i)
  if (missingTable) return `DB_NO_SUCH_TABLE:${safeIdentifier(missingTable)}`
  const missingColumn = match(/no such column:\s*([A-Za-z0-9_.-]+)/i)
  if (missingColumn) return `DB_NO_SUCH_COLUMN:${safeIdentifier(missingColumn)}`
  const insertColumn = match(/has no column named\s+([A-Za-z0-9_.-]+)/i)
  if (insertColumn) return `DB_NO_COLUMN:${safeIdentifier(insertColumn)}`
  const notNull = match(/not null constraint failed:\s*([A-Za-z0-9_.-]+)/i)
  if (notNull) return `DB_NOT_NULL:${safeIdentifier(notNull)}`
  const unique = match(/unique constraint failed:\s*([A-Za-z0-9_.-]+)/i)
  if (unique) return `DB_UNIQUE:${safeIdentifier(unique)}`
  if (lower.includes('foreign key constraint failed')) return 'DB_FOREIGN_KEY'
  if (lower.includes('unable to create session') || lower.includes('failed to create session')) return 'SESSION_CREATE_FAILED'
  if (lower.includes('unsupported type') || lower.includes('not supported type') || lower.includes('type date is not supported')) return 'D1_BIND_TYPE_ERROR'
  if (lower.includes('d1_error') || lower.includes('d1 error')) return 'D1_ERROR'
  if (lower.includes('sqlite')) return 'SQLITE_ERROR'
  if (lower.includes('password') && (lower.includes('hash') || lower.includes('bcrypt'))) return 'PASSWORD_HASH_ERROR'
  if (lower.includes('database')) return 'AUTH_DATABASE_ERROR'

  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null
  const code = record?.code ? safeIdentifier(String(record.code)) : ''
  const name = error instanceof Error ? safeIdentifier(error.name) : ''
  if (code) return `AUTH_ERROR:${code}`
  if (name && name !== 'Error') return `AUTH_ERROR:${name}`
  return 'AUTH_INTERNAL_ERROR'
}

function isStaging(bindings: BetterAuthRuntimeBindings): boolean {
  return String(bindings.APP_ENV || '').toLowerCase() === 'staging'
}

function recordDiagnostic(bindings: BetterAuthRuntimeBindings, sink: AuthDiagnosticSink | undefined, error: unknown): void {
  if (!isStaging(bindings)) return
  const code = classifyAuthError(error)
  if (sink && !sink.code) sink.code = code
  console.error(JSON.stringify({ event: 'better_auth.error', diagnostic: code, environment: 'staging' }))
}

function collectionSize(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (value instanceof Map || value instanceof Set) return value.size
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length
  return 0
}

async function refineSchemaDiagnostic(
  options: MigrationOptions,
  currentCode: string | undefined,
): Promise<string> {
  try {
    const migrations = await getMigrations(options)
    const createCount = collectionSize(migrations.toBeCreated)
    const addCount = collectionSize(migrations.toBeAdded)
    if (createCount || addCount) return `AUTH_SCHEMA_DRIFT:C${createCount}:A${addCount}`
    return `${currentCode || 'AUTH_INTERNAL_ERROR'}:SCHEMA_OK`
  } catch (error) {
    return `${currentCode || 'AUTH_INTERNAL_ERROR'}:SCHEMA_CHECK_${classifyAuthError(error)}`
  }
}

export function createBetterAuthRuntime(
  bindings: BetterAuthRuntimeBindings,
  requestOrigin: string,
  diagnostics?: AuthDiagnosticSink,
) {
  const database = requireAuthDatabase(bindings)
  const secret = String(bindings.BETTER_AUTH_SECRET || '')

  return betterAuth({
    database,
    secret,
    baseURL: requestOrigin,
    basePath: '/api/auth',
    trustedOrigins: trustedOrigins(bindings, requestOrigin),
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/request-password-reset': { window: 900, max: 3 },
        '/reset-password': { window: 900, max: 5 },
        '/change-password': { window: 900, max: 5 },
        '/sign-in/email': { window: 60, max: 5 },
      },
    },
    logger: isStaging(bindings) ? {
      level: 'error',
      disableColors: true,
      log: (level, message, ...args) => {
        if (level !== 'error') return
        recordDiagnostic(bindings, diagnostics, { message, args })
      },
    } : undefined,
    onAPIError: isStaging(bindings) ? {
      onError: (error) => recordDiagnostic(bindings, diagnostics, error),
    } : undefined,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: BCRYPT_MAX_BYTES,
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) => {
          try {
            await sendPasswordRecoveryEmail(bindings, user.email, url)
          } catch {
            // Keep the public response identical for existing and unknown accounts,
            // including provider outages. Never log the address or reset token.
            console.error(JSON.stringify({ event: 'auth.recovery_delivery_failed' }))
          }
        },
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
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
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

  const diagnostics: AuthDiagnosticSink = {}
  if (url.pathname === '/api/auth/request-password-reset' && !recoveryEmailConfigured(bindings)) {
    return Response.json({ code: 'RECOVERY_UNAVAILABLE', message: 'Recuperação de senha indisponível. Entre em contato com o suporte.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
  const auth = createBetterAuthRuntime(bindings, url.origin, diagnostics)
  let response: Response
  try {
    response = await auth.handler(request)
  } catch (error) {
    recordDiagnostic(bindings, diagnostics, error)
    const headers = new Headers({ 'cache-control': 'no-store' })
    if (isStaging(bindings)) {
      headers.set(AUTH_DIAGNOSTIC_HEADER, await refineSchemaDiagnostic(auth.options, diagnostics.code))
    }
    return Response.json({ code: 'AUTH_INTERNAL_ERROR' }, { status: 500, headers })
  }

  const headers = new Headers(response.headers)
  if (isStaging(bindings) && response.status >= 500) {
    headers.set(AUTH_DIAGNOSTIC_HEADER, await refineSchemaDiagnostic(auth.options, diagnostics.code))
  }
  if (origin && allowedOrigins.includes(origin)) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.append('vary', 'Origin')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export async function getBetterAuthSession(request: Request, bindings: BetterAuthRuntimeBindings) {
  if (!isBetterAuthRuntimeEnabled(bindings) || getAuthDatabaseReadiness(bindings) !== 'configured') return null
  const auth = createBetterAuthRuntime(bindings, new URL(request.url).origin)
  return auth.api.getSession({ headers: request.headers })
}
