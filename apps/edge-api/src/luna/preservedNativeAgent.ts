import { DurableObject } from 'cloudflare:workers'

/**
 * A staging experiment provisioned this class before it reached main.
 * Keep its SQLite namespace live so subsequent releases preserve its data.
 * This compatibility class has no application binding, accepts no work,
 * and never reads, initializes, migrates or deletes the stored agent state.
 * Restore the native implementation before routing work into this namespace.
 */
export class LunaNativeAgent extends DurableObject {
  async fetch(): Promise<Response> {
    return Response.json({ code: 'LUNA_NATIVE_AGENT_DISABLED' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }

  // Old experiment alarms must not resume model calls or operational effects.
  // Leave persisted jobs and checkpoints intact for a future explicit restore.
  async alarm(): Promise<void> {}
}
