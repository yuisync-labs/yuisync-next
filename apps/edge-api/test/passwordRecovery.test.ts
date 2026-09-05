import { env } from 'cloudflare:workers'
import { compare, hash } from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'
import { handleBetterAuthRequest } from '../src/auth/betterAuthRuntime'

describe('password recovery on D1', () => {
  it('uses a one-time token, changes the hash, revokes sessions and limits requests', async () => {
    const database = (env as EdgeEnv & { AUTH_DB: D1Database }).AUTH_DB
    const id = crypto.randomUUID()
    const email = `${id}@test.invalid`
    const now = new Date().toISOString()
    const runtime = { ...env, AUTH_DB: database, EDGE_BETTER_AUTH_ENABLED: 'true', BETTER_AUTH_SECRET: 'password-recovery-test-secret-at-least-32-characters', AUTH_EMAIL_API_KEY: 'test-key', AUTH_EMAIL_FROM: 'YuiSync <test@test.invalid>' }
    const delivered: string[] = []
    const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.resend.com/emails')
      delivered.push(String(init?.body))
      return Response.json({ id: 'test-email' })
    })
    const call = (path: string, body: unknown) => handleBetterAuthRequest(new Request(`https://edge.test/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://edge.test', 'cf-connecting-ip': '192.0.2.81' }, body: JSON.stringify(body),
    }), runtime)
    await database.batch([
      database.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?1,?2,?3,1,?4,?4)').bind(id, 'Recovery Test', email, now),
      database.prepare('INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?2,?2,\'credential\',?3,?4,?4)').bind(`credential:${id}`, id, await hash('OldPassword123!', 12), now),
    ])
    try {
      expect((await call('sign-in/email', { email, password: 'OldPassword123!' }))?.status).toBe(200)
      const requested = await call('request-password-reset', { email, redirectTo: 'https://edge.test/recuperar-senha' })
      expect(requested?.status).toBe(200)
      expect(delivered).toHaveLength(1)
      const token = /reset-password\/([^?\s]+)/.exec(JSON.parse(delivered[0]).text)?.[1]
      expect(token).toBeTruthy()
      expect(JSON.stringify(await requested?.json())).not.toContain(token)
      const saved = await database.prepare('SELECT expiresAt FROM verification WHERE identifier=?1').bind(`reset-password:${token}`).first<{ expiresAt: string }>()
      expect(Date.parse(saved!.expiresAt) - Date.now()).toBeLessThanOrEqual(900000)
      expect((await call('reset-password', { token, newPassword: 'NewPassword456!' }))?.status).toBe(200)
      const credential = await database.prepare('SELECT password FROM account WHERE userId=?1').bind(id).first<{ password: string }>()
      expect(await compare('NewPassword456!', credential!.password)).toBe(true)
      expect((await database.prepare('SELECT id FROM session WHERE userId=?1').bind(id).all()).results).toHaveLength(0)
      expect((await call('reset-password', { token, newPassword: 'AnotherPassword789!' }))?.status).toBe(400)
      expect((await call('request-password-reset', { email: 'missing@test.invalid' }))?.status).toBe(200)
      expect((await call('request-password-reset', { email: 'missing@test.invalid' }))?.status).toBe(200)
      expect((await call('request-password-reset', { email: 'missing@test.invalid' }))?.status).toBe(429)
      expect(delivered).toHaveLength(1)
      send.mockResolvedValue(new Response('private provider error', { status: 503 }))
      const failureLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const outageCall = (targetEmail: string) => handleBetterAuthRequest(new Request('https://edge.test/api/auth/request-password-reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://edge.test', 'cf-connecting-ip': '192.0.2.82' },
          body: JSON.stringify({ email: targetEmail }),
        }), runtime)
        const known = await outageCall(email)
        const unknown = await outageCall('missing@test.invalid')
        expect(known?.status).toBe(200)
        expect(unknown?.status).toBe(200)
        expect(await known?.json()).toEqual(await unknown?.json())
        expect(failureLog).toHaveBeenCalledWith(JSON.stringify({ event: 'auth.recovery_delivery_failed' }))
        expect(JSON.stringify(failureLog.mock.calls)).not.toContain(email)
      } finally {
        failureLog.mockRestore()
      }
    } finally {
      send.mockRestore()
      await database.prepare('DELETE FROM user WHERE id=?1').bind(id).run()
    }
  })
})
