import { Agent } from 'agents'
import { executeInternalChatJob, type InternalChatJob, type NativeLunaBindings } from './internalChatTurn'
import { durableTurnQueue } from './durableTurnQueue'
import { createD1TurnJournal, LunaCheckpointError } from './turnJournal'
import { hashCanonicalJson } from './canonicalJson'
import { lunaJournalConfiguration } from './providers/providerFactory'

// The Durable Object may receive another request while the current request
// awaits Groq or D1. Serialize turns so retries and simultaneous messages
// cannot interleave D1 history reads and generation within one chat thread.
export function serializeAgentTurns<RequestType, ResultType>(
  execute: (request: RequestType) => Promise<ResultType>,
): (request: RequestType) => Promise<ResultType> {
  let settled: Promise<void> = Promise.resolve()
  return (request) => {
    const current = settled.then(() => execute(request))
    // A failed request must not permanently block the next turn.
    settled = current.then(() => undefined, () => undefined)
    return current
  }
}

// Private Worker dispatch only. Cloudflare owns scheduling; Vercel's
// ToolLoopAgent owns planning. The same native runtime/journal owns effects.
export class LunaNativeAgent extends Agent<NativeLunaBindings> {
  private readonly pendingTurns = durableTurnQueue({
    get: this.ctx.storage.get.bind(this.ctx.storage),
    put: this.ctx.storage.put.bind(this.ctx.storage),
    // Short storage transactions only; never block HTTP admission on Groq.
    withMutation: async execute => {
      // Expected conflicts must escape OUTSIDE blockConcurrencyWhile; throwing
      // inside that callback breaks the object's input gate and resets it.
      const outcome = await this.ctx.blockConcurrencyWhile(async () => {
        try { return {value: await execute()} }
        catch (error) { return {error} }
      })
      if ('error' in outcome) throw outcome.error
      return outcome.value
    },
    setAlarm: async (at: number | Date) => {
      // Do not override Agent.alarm() or its storage alarm. No SDK retry of
      // an uncertain inference/commit: journal replay decides what is safe.
      await this.schedule(new Date(at), 'processPendingTurns', String(Number(at)), {idempotent: true, retry: {maxAttempts: 1}})
    },
  }, async job => {
    const payload = job.payload as InternalChatJob
    if (!this.env.DB) throw new LunaCheckpointError('DATABASE_NOT_CONFIGURED')
    return executeInternalChatJob(payload, this.env, createD1TurnJournal(this.env.DB, payload.context, lunaJournalConfiguration(this.env, `internal:${payload.releaseSha}:${payload.model}`)))
  })
  private readonly serial = serializeAgentTurns((execute: () => Promise<unknown>) => execute())
  private readonly processing = serializeAgentTurns(() => this.pendingTurns.process())

  async processPendingTurns(): Promise<void> { await this.processing(undefined) }

  async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (this.env.APP_ENV !== 'staging' || this.env.LUNA_INTERNAL_CHAT_ENABLED !== 'true') return Response.json({code: 'LUNA_INTERNAL_CHAT_DISABLED'}, {status: 404})
    if (request.method === 'GET' && /^\/turns\/(latest|[a-f0-9]{64})$/.test(path)) {
      const id = path.endsWith('/latest') ? await this.ctx.storage.get<string>('luna-job-latest') : path.split('/').pop()
      const job = id ? await this.pendingTurns.load(id) : undefined
      if (!job) return Response.json({code: 'LUNA_TURN_NOT_FOUND'}, {status: 404})
      const {payload: _private, ...status} = job
      return Response.json(status, {headers: {'cache-control': 'no-store'}})
    }
    if (request.method !== 'POST' || path !== '/submit') return Response.json({code: 'NOT_FOUND'}, {status: 404})
    try {
      const payload = await request.json() as InternalChatJob
      if (payload.kind !== 'internal-chat' || payload.context?.moduleId !== 'petshop' || payload.context.executionMode !== 'staging'
        || !payload.message || !payload.principalId || !payload.context.sourceMessageId || !payload.model) throw new LunaCheckpointError('LUNA_JOB_INVALID')
      const scope = `${payload.context.tenantId}:${payload.context.moduleId}:${payload.context.conversationId}`
      const id = await hashCanonicalJson([payload.context.tenantId, payload.context.moduleId, payload.context.conversationId, payload.context.sourceMessageId])
      const job = await this.serial(async () => {
        const priorScope = await this.ctx.storage.get<string>('luna-internal-scope')
        if (priorScope && priorScope !== scope) throw new LunaCheckpointError('LUNA_JOB_SCOPE_CONFLICT')
        await this.ctx.storage.put('luna-internal-scope', scope)
        return this.pendingTurns.submit(id, payload)
      }) as Awaited<ReturnType<typeof this.pendingTurns.submit>>
      return Response.json({accepted: true, turn_id: job.id, status: job.status}, {status: 202, headers: {'cache-control': 'no-store'}})
    } catch (error) {
      return Response.json({code: error instanceof LunaCheckpointError ? error.code : 'INVALID_JSON'}, {status: error instanceof LunaCheckpointError ? 409 : 400})
    }
  }
}
