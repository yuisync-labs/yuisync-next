const MAX_BEARER_TOKEN_LENGTH = 8_192

export type BearerTokenParseResult =
  | Readonly<{
    kind: 'token'
    token: string
  }>
  | Readonly<{
    kind: 'missing'
  }>
  | Readonly<{
    kind: 'malformed'
  }>

export function parseBearerToken(
  authorizationHeader: string | null | undefined,
): BearerTokenParseResult {
  if (authorizationHeader == null || authorizationHeader.trim() === '') {
    return { kind: 'missing' }
  }

  if (authorizationHeader.length > MAX_BEARER_TOKEN_LENGTH + 32) {
    return { kind: 'malformed' }
  }

  const match = authorizationHeader.match(/^\s*Bearer[\t ]+([^\s]+)\s*$/i)
  if (!match?.[1] || match[1].length > MAX_BEARER_TOKEN_LENGTH) {
    return { kind: 'malformed' }
  }

  return {
    kind: 'token',
    token: match[1],
  }
}
