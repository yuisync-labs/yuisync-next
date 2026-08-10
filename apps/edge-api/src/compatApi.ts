import {
  COMPAT_TABLE_NAMES as BASE_COMPAT_TABLE_NAMES,
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import {
  DEFERRED_COMPAT_RPC_NAMES,
  DEFERRED_COMPAT_TABLE_NAMES,
  handleDeferredCompatApiRequest,
} from './compatDeferredApi'
import {
  handleOperationalCompatRpcRequest,
  OPERATIONAL_COMPAT_RPC_NAMES,
} from './compatOperationalRpc'
import {
  handleSubscriptionCompatRpcRequest,
  SUBSCRIPTION_COMPAT_RPC_NAMES,
} from './compatSubscriptionRpc'

export async function handleCompatApiRequest(
  request: Request,
  env: CompatRuntimeBindings,
): Promise<Response | null> {
  // Deferred compat probes the generic /api/compat/query and /rpc endpoints and
  // may parse the body before deciding the requested table/RPC is not one of
  // its own. Keep the original Request body untouched for the remaining
  // fallbacks, especially the base compat runtime.
  const deferredResponse = await handleDeferredCompatApiRequest(request.clone(), env)
  if (deferredResponse) return deferredResponse
  const subscriptionResponse = await handleSubscriptionCompatRpcRequest(request, env)
  if (subscriptionResponse) return subscriptionResponse
  const operationalResponse = await handleOperationalCompatRpcRequest(request, env)
  if (operationalResponse) return operationalResponse
  return handleBaseCompatApiRequest(request, env)
}

export const COMPAT_TABLE_NAMES = Object.freeze([
  ...BASE_COMPAT_TABLE_NAMES,
  ...DEFERRED_COMPAT_TABLE_NAMES,
])
export const COMPAT_RPC_NAMES = Object.freeze([
  ...OPERATIONAL_COMPAT_RPC_NAMES,
  ...SUBSCRIPTION_COMPAT_RPC_NAMES,
  ...DEFERRED_COMPAT_RPC_NAMES,
])
export type { CompatRuntimeBindings } from './compatApiRuntime.js'
