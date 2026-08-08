import {
  COMPAT_TABLE_NAMES as BASE_COMPAT_TABLE_NAMES,
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
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
  const subscriptionResponse = await handleSubscriptionCompatRpcRequest(request, env)
  if (subscriptionResponse) return subscriptionResponse
  const operationalResponse = await handleOperationalCompatRpcRequest(request, env)
  if (operationalResponse) return operationalResponse
  return handleBaseCompatApiRequest(request, env)
}

export const COMPAT_TABLE_NAMES = BASE_COMPAT_TABLE_NAMES
export const COMPAT_RPC_NAMES = Object.freeze([
  ...OPERATIONAL_COMPAT_RPC_NAMES,
  ...SUBSCRIPTION_COMPAT_RPC_NAMES,
])
export type { CompatRuntimeBindings } from './compatApiRuntime.js'
