import type { CoordinationPort } from '../../../../server/application/ports/coordination'
import { CloudflareDurableObjectCoordinationAdapter } from '../adapters/cloudflareDurableObjectCoordinationAdapter'
import type { CoordinationDurableObject } from './coordinationDurableObject'
import { isEdgeCoordinationEnabled } from './coordinationFeature'

type CoordinationEnv = EdgeEnv & Readonly<{
  EDGE_COORDINATION_ENABLED?: string
  COORDINATOR?: DurableObjectNamespace<CoordinationDurableObject>
}>

export function createCoordinationPort(env: EdgeEnv): CoordinationPort {
  const coordinationEnv = env as CoordinationEnv
  return new CloudflareDurableObjectCoordinationAdapter(
    coordinationEnv.COORDINATOR,
    isEdgeCoordinationEnabled(coordinationEnv.EDGE_COORDINATION_ENABLED),
  )
}
