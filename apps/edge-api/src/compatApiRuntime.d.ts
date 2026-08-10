import type { BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'

export type CompatRuntimeBindings = BetterAuthRuntimeBindings & { DB?: D1Database }

export function handleCompatApiRequest(request: Request, env: CompatRuntimeBindings): Promise<Response | null>
export const COMPAT_TABLE_NAMES: readonly string[]
