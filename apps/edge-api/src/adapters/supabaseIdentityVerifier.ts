import type {
  IdentityVerificationPort,
  IdentityVerificationResult,
} from '../../../../server/application/ports/identityVerification'

const DEFAULT_TIMEOUT_MS = 3_000
const MAX_TIMEOUT_MS = 10_000
const MAX_ACCESS_TOKEN_LENGTH = 8_192
const MAX_PUBLISHABLE_KEY_LENGTH = 4_096

type Fetcher = typeof fetch

type SupabaseIdentityVerifierOptions = Readonly<{
  supabaseUrl: string
  publishableKey: string
  fetcher?: Fetcher
  timeoutMs?: number
}>

type SupabaseUserPayload = Readonly<{
  id?: unknown
}>

export type SupabaseIdentityVerifierErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'IDENTITY_PROVIDER_UNAVAILABLE'
  | 'IDENTITY_PROVIDER_PROTOCOL_ERROR'

export class SupabaseIdentityVerifierError extends Error {
  readonly code: SupabaseIdentityVerifierErrorCode

  constructor(code: SupabaseIdentityVerifierErrorCode) {
    super('Identity verification could not be completed.')
    this.name = 'SupabaseIdentityVerifierError'
    this.code = code
  }
}

function normalizeSupabaseUserEndpoint(value: string): string {
  const trimmed = value.trim()
  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    throw new SupabaseIdentityVerifierError('INVALID_CONFIGURATION')
  }

  const isLocalhost = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new SupabaseIdentityVerifierError('INVALID_CONFIGURATION')
  }

  url.pathname = '/auth/v1/user'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function normalizePublishableKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > MAX_PUBLISHABLE_KEY_LENGTH || /\s/.test(key)) {
    throw new SupabaseIdentityVerifierError('INVALID_CONFIGURATION')
  }
  return key
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new SupabaseIdentityVerifierError('INVALID_CONFIGURATION')
  }
  return timeoutMs
}

function isValidAccessToken(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_ACCESS_TOKEN_LENGTH
    && !/\s/.test(value)
}

function parseSubject(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const id = (payload as SupabaseUserPayload).id
  if (typeof id !== 'string') return null

  const subject = id.trim()
  return subject && subject.length <= 255 ? subject : null
}

export class SupabaseIdentityVerifier implements IdentityVerificationPort {
  private readonly endpoint: string
  private readonly publishableKey: string
  private readonly fetcher: Fetcher
  private readonly timeoutMs: number

  constructor(options: SupabaseIdentityVerifierOptions) {
    this.endpoint = normalizeSupabaseUserEndpoint(options.supabaseUrl)
    this.publishableKey = normalizePublishableKey(options.publishableKey)
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = normalizeTimeout(options.timeoutMs)
  }

  async verifyAccessToken(accessToken: string): Promise<IdentityVerificationResult> {
    const token = accessToken.trim()
    if (!isValidAccessToken(token)) {
      return {
        authenticated: false,
        reason: 'invalid_token',
      }
    }

    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          apikey: this.publishableKey,
          authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new SupabaseIdentityVerifierError('IDENTITY_PROVIDER_UNAVAILABLE')
    }

    if (response.status === 401 || response.status === 403) {
      return {
        authenticated: false,
        reason: 'invalid_token',
      }
    }

    if (!response.ok) {
      throw new SupabaseIdentityVerifierError('IDENTITY_PROVIDER_UNAVAILABLE')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new SupabaseIdentityVerifierError('IDENTITY_PROVIDER_PROTOCOL_ERROR')
    }

    const subject = parseSubject(payload)
    if (!subject) {
      throw new SupabaseIdentityVerifierError('IDENTITY_PROVIDER_PROTOCOL_ERROR')
    }

    return {
      authenticated: true,
      identity: {
        provider: 'supabase',
        subject,
      },
    }
  }
}
