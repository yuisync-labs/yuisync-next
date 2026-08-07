import { hasD1Binding, isEdgeDatabaseEnabled } from '../databaseFeature'
import type { EdgeFoundationMigrationBindings } from '../types'

const MIN_MIGRATION_TOKEN_LENGTH = 32
const MAX_MIGRATION_TOKEN_LENGTH = 512

export const FOUNDATION_MIGRATION_ROUTE = '/internal/migration/foundation'
export const FOUNDATION_MIGRATION_MAX_BODY_BYTES = 256 * 1024

export function isFoundationMigrationEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export type FoundationMigrationConfiguration = Readonly<{
  ready: boolean
  missing: readonly string[]
  wrongEnvironment: boolean
}>

type FoundationMigrationEnvironment = EdgeFoundationMigrationBindings & Readonly<{
  APP_ENV?: string
  EDGE_DATABASE_ENABLED?: string
  DB?: D1Database
}>

function validMigrationToken(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  const length = value.length
  return length >= MIN_MIGRATION_TOKEN_LENGTH
    && length <= MAX_MIGRATION_TOKEN_LENGTH
    && value.trim() === value
    && !/[\r\n]/.test(value)
}

export function getFoundationMigrationConfiguration(
  env: FoundationMigrationEnvironment,
): FoundationMigrationConfiguration {
  const missing: string[] = []
  const wrongEnvironment = String(env.APP_ENV || '').trim().toLowerCase() !== 'staging'

  if (!isEdgeDatabaseEnabled(env.EDGE_DATABASE_ENABLED)) {
    missing.push('EDGE_DATABASE_ENABLED')
  }
  if (!hasD1Binding(env.DB)) {
    missing.push('DB')
  }
  if (!validMigrationToken(env.FOUNDATION_MIGRATION_TOKEN)) {
    missing.push('FOUNDATION_MIGRATION_TOKEN')
  }

  return {
    ready: !wrongEnvironment && missing.length === 0,
    missing,
    wrongEnvironment,
  }
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return new Uint8Array(digest)
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let different = 0
  for (let index = 0; index < left.length; index += 1) {
    different |= left[index] ^ right[index]
  }
  return different === 0
}

export async function verifyFoundationMigrationToken(
  provided: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (!validMigrationToken(expected)) return false

  // Hash both sides even when the provided token has the wrong length so the
  // comparison path does not return based on a prefix/character mismatch.
  const providedValue = typeof provided === 'string' ? provided : ''
  const [providedDigest, expectedDigest] = await Promise.all([
    sha256(providedValue),
    sha256(expected),
  ])

  return providedValue.length === expected.length
    && constantTimeEqual(providedDigest, expectedDigest)
}
