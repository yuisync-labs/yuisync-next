export type ModuleBaseSettings = Readonly<{
  tenantId: string
  moduleId: string
  storeName: string
  storePhone: string
  storeAddress: string
  storeNeighborhood: string
  storeCity: string
  botPrompt: string
  version: number
  createdAtMs: number
  updatedAtMs: number
}>

export type ModuleBaseSettingsDraft = Readonly<{
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeNeighborhood?: string
  storeCity?: string
  botPrompt?: string
}>

export type SaveModuleBaseSettingsRequest = Readonly<{
  tenantId: string
  moduleId: string
  settings: ModuleBaseSettingsDraft
  expectedVersion: number | null
  nowMs: number
}>

export type SaveModuleBaseSettingsResult =
  | Readonly<{
    kind: 'saved'
    settings: ModuleBaseSettings
  }>
  | Readonly<{
    kind: 'conflict'
  }>

export interface ModuleSettingsPort {
  getBaseSettings(tenantId: string, moduleId: string): Promise<ModuleBaseSettings | null>
  saveBaseSettings(request: SaveModuleBaseSettingsRequest): Promise<SaveModuleBaseSettingsResult>
}
