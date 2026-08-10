import { env } from 'cloudflare:workers'
import { hash } from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'

const AUTH_SECRET = 'better-auth-d1-test-secret-123456789012345678901234'

function bindings() {
  return {
    ...(env as EdgeEnv),
    APP_ENV: 'staging',
    EDGE_BETTER_AUTH_ENABLED: 'true',
    BETTER_AUTH_SECRET: AUTH_SECRET,
    AUTH_DB: (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB,
  }
}

describe('Better Auth native D1 runtime', () => {
  it('signs in a credential user and persists a session using the real D1 dialect', async () => {
    const database = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const userId = crypto.randomUUID()
    const email = `d1-${userId}@test.invalid`
    const password = 'ValidPassword123!'
    const passwordHash = await hash(password, 12)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    await database.batch([
      database.prepare('INSERT INTO user(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?1,?2,?3,1,NULL,?4,?4)')
        .bind(userId, 'D1 Test User', email, nowIso),
      database.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?3,?4,?5,?6,?6)')
        .bind(`credential:${userId}`, userId, userId, 'credential', passwordHash, nowIso),
    ])

    try {
      const response = await handleBetterAuthRequest(new Request('https://edge.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://edge.test',
        },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }), bindings())

      expect(response).not.toBeNull()
      if (!response) return
      const responseBody = await response.clone().text()
      expect(response.status, `${responseBody} diagnostic=${response.headers.get('x-yuisync-auth-diagnostic') || ''}`).toBe(200)
      expect(response.headers.get('set-cookie')).toContain('better-auth')

      const sessions = await database.prepare('SELECT id,userId,token,expiresAt,createdAt,updatedAt FROM session WHERE userId=?1').bind(userId).all()
      expect(sessions.results).toHaveLength(1)
      expect(sessions.results[0]).toEqual(expect.objectContaining({ userId }))
      expect(Date.parse(String(sessions.results[0]?.expiresAt))).toBeGreaterThan(now)
      expect(typeof sessions.results[0]?.createdAt).toBe('string')
      expect(typeof sessions.results[0]?.updatedAt).toBe('string')
    } finally {
      await database.prepare('DELETE FROM session WHERE userId=?1').bind(userId).run()
      await database.prepare('DELETE FROM account WHERE userId=?1').bind(userId).run()
      await database.prepare('DELETE FROM user WHERE id=?1').bind(userId).run()
    }
  })
})
