import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import type { LunaNativeAgent } from '../src/luna/preservedNativeAgent'

it('preserves experiment state and refuses execution across requests and alarms', async () => {
  const namespace = (env as Partial<{ LUNA_NATIVE_PRESERVED: DurableObjectNamespace<LunaNativeAgent> }>).LUNA_NATIVE_PRESERVED
  if (!namespace) throw new Error('PRESERVED_NAMESPACE_TEST_BINDING_REQUIRED')
  const stub = namespace.get(namespace.newUniqueId())
  const checkpoint = { id: 'old-turn', status: 'pending', payload: { message: 'existing' } }
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.put('luna-job-latest', checkpoint)
    state.storage.sql.exec('CREATE TABLE legacy_state (id TEXT PRIMARY KEY, value TEXT)')
    state.storage.sql.exec('INSERT INTO legacy_state VALUES (?, ?)', 'checkpoint', JSON.stringify(checkpoint))
  })

  const response = await stub.fetch('https://preserved.test/submit', { method: 'POST', body: '{}' })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ code: 'LUNA_NATIVE_AGENT_DISABLED' })
  await runInDurableObject(stub, async (instance, state) => {
    await instance.alarm()
    expect(await state.storage.get('luna-job-latest')).toEqual(checkpoint)
    expect(state.storage.sql.exec<{ value: string }>('SELECT value FROM legacy_state WHERE id = ?', 'checkpoint').one().value).toBe(JSON.stringify(checkpoint))
  })
})
