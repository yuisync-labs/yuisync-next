export type ReleaseIdentityBindings = {
  APP_ENV?: string
  SERVICE_NAME?: string
  RELEASE_CHANNEL?: string
  RELEASE_SHA?: string
}

export function handleReleaseIdentity(request: Request, bindings: ReleaseIdentityBindings): Response | null {
  const { pathname } = new URL(request.url)
  if (pathname !== '/release' || request.method !== 'GET') return null
  const releaseSha = String(bindings.RELEASE_SHA || '').trim().toLowerCase()
  const valid = /^[0-9a-f]{40}$/.test(releaseSha)
  return Response.json({
    service: bindings.SERVICE_NAME || null,
    environment: bindings.APP_ENV || null,
    release_channel: bindings.RELEASE_CHANNEL || null,
    release_sha: valid ? releaseSha : null,
    status: valid ? 'identified' : 'unidentified',
  }, {
    status: valid ? 200 : 503,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}
