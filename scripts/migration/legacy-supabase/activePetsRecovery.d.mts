export type RecoveryClient = { id: string; name: string; document?: string | null; phone?: string | null; created_at_ms: number; updated_at_ms: number }
export type RecoveryPet = { id: string; client_id: string; name?: string; status?: string }
export type RecoveryOwner = { id: string; name: string; pet_id: string; pet_name: string; document?: string | null; phone?: string | null }
export type RecoveryRow = {
  tenant_id: string; module_id: string; id: string; client_id: string; name: string; species: string;
  breed: string | null; birth_date: string | null; weight_kg: number | null; color: string | null; notes: string | null;
  status: string; created_at_ms: number; updated_at_ms: number; expected_client_updated_at_ms: number; planned_pet_ids: string[];
}
export function planActivePetsRecovery(input: {
  scope: { tenant_id: string; module_id: string }; nextClients: RecoveryClient[]; sourceRows: unknown[][];
  existingPets?: RecoveryPet[]; existingOwners?: RecoveryOwner[]; now?: number;
}): { rows: RecoveryRow[]; clients: string[]; skipped: Array<Record<string, unknown>>; invalid: Array<Record<string, unknown>>; hash: string }
export const ACTIVE_PET_RECOVERY_INSERT_SQL: string
