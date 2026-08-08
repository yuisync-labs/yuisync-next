import {
  COMPAT_TABLE_NAMES as BASE_COMPAT_TABLE_NAMES,
  handleCompatApiRequest as handleBaseCompatApiRequest,
  type CompatRuntimeBindings,
} from './compatApiRuntime.js'
import {
  handleOperationalCompatRpcRequest,
  OPERATIONAL_COMPAT_RPC_NAMES,
} from './compatOperationalRpc'

export async function handleCompatApiRequest(
  request: Request,
  env: CompatRuntimeBindings,
): Promise<Response | null> {
  const operationalResponse = await handleOperationalCompatRpcRequest(request, env)
  if (operationalResponse) return operationalResponse
  return handleBaseCompatApiRequest(request, env)
}

export const COMPAT_TABLE_NAMES = BASE_COMPAT_TABLE_NAMES
export const COMPAT_RPC_NAMES = OPERATIONAL_COMPAT_RPC_NAMES
export type { CompatRuntimeBindings } from './compatApiRuntime.js'
