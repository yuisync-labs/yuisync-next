import { describe, expect, it } from 'vitest'
import { serializeAgentTurns } from '../src/luna/nativeCloudflareAgent'

describe('Cloudflare native Luna Agent turn isolation', () => {
  it('runs simultaneous turns on one instance in arrival order', async () => {
    const started: string[] = []
    let release!: () => void
    const firstGate = new Promise<void>(resolve => { release = resolve })
    const run = serializeAgentTurns(async (id: string): Promise<string> => {
      started.push(id)
      if (id === 'first') await firstGate
      return id
    })

    const first = run('first')
    const second = run('second')
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['first'])
    release()
    expect(await first).toBe('first')
    expect(await second).toBe('second')
    expect(started).toEqual(['first', 'second'])
  })

  it('allows the next queued turn to execute after a provider failure', async () => {
    const started: number[] = []
    const run = serializeAgentTurns(async (turn: number) => {
      started.push(turn)
      if (turn === 1) throw new Error('provider failed')
      return 'recovered'
    })
    const failed = run(1)
    const next = run(2)
    await expect(failed).rejects.toThrow('provider failed')
    await expect(next).resolves.toBe('recovered')
    expect(started).toEqual([1, 2])
  })
})
