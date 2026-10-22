// Deployment visibility can lag at another edge. Re-read only the public
// release identity; never redeploy, change a gate, or accept a different SHA.
export async function waitForStagingRelease(baseUrl, sha, { fetchFn = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const url = new URL('release', baseUrl)
  if (url.origin !== 'https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('CERTIFICATION_RELEASE_TARGET_INVALID')
  for (let attempt = 0; attempt < 6; attempt++) {
    let release
    try {
      const response = await fetchFn(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (response.ok) release = await response.json()
    } catch { /* one bounded public read failed; no commercial action */ }
    if (release?.environment && release.environment !== 'staging') throw new Error('CERTIFICATION_RELEASE_ENVIRONMENT_MISMATCH')
    if (release?.environment === 'staging' && release.release_sha === sha) return release
    if (attempt < 5) await pause(2000)
  }
  throw new Error('CERTIFICATION_RELEASE_SHA_MISMATCH')
}
