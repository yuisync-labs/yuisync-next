import type { CoordinationDurableObject } from './coordinationDurableObject'

export function isEdgeCoordinationEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function hasCoordinationBinding(
  binding: DurableObjectNamespace<CoordinationDurableObject> | undefined,
): binding is DurableObjectNamespace<CoordinationDurableObject> {
  return Boolean(binding)
}
