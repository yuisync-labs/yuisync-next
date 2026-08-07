import { FOUNDATION_MIGRATION_MAX_BODY_BYTES } from './foundationMigrationFeature'

export type FoundationMigrationRequestErrorCode =
  | 'CONTENT_TYPE_REQUIRED'
  | 'BODY_TOO_LARGE'
  | 'BODY_INVALID'

export class FoundationMigrationRequestError extends Error {
  readonly code: FoundationMigrationRequestErrorCode
  readonly status: 400 | 413 | 415

  constructor(code: FoundationMigrationRequestErrorCode, status: 400 | 413 | 415) {
    super('Foundation migration request is invalid.')
    this.name = 'FoundationMigrationRequestError'
    this.code = code
    this.status = status
  }
}

function contentLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  if (!raw) return null
  if (!/^\d+$/.test(raw)) {
    throw new FoundationMigrationRequestError('BODY_INVALID', 400)
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new FoundationMigrationRequestError('BODY_INVALID', 400)
  }
  return parsed
}

export async function readFoundationMigrationSnapshot(request: Request): Promise<unknown> {
  const contentType = String(request.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (contentType !== 'application/json') {
    throw new FoundationMigrationRequestError('CONTENT_TYPE_REQUIRED', 415)
  }

  const declaredLength = contentLength(request)
  if (declaredLength !== null && declaredLength > FOUNDATION_MIGRATION_MAX_BODY_BYTES) {
    throw new FoundationMigrationRequestError('BODY_TOO_LARGE', 413)
  }

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) {
    throw new FoundationMigrationRequestError('BODY_INVALID', 400)
  }
  if (body.byteLength > FOUNDATION_MIGRATION_MAX_BODY_BYTES) {
    throw new FoundationMigrationRequestError('BODY_TOO_LARGE', 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new FoundationMigrationRequestError('BODY_INVALID', 400)
  }

  return parsed
}
