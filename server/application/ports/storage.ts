export type ObjectMetadata = Readonly<Record<string, string>>

export type StoredObject = Readonly<{
  key: string
  body: Uint8Array
  content_type: string | null
  etag: string | null
  metadata: ObjectMetadata
}>

export type ObjectWriteOptions = Readonly<{
  content_type?: string | null
  metadata?: ObjectMetadata
  if_none_match?: boolean
}>

export interface ObjectStoragePort {
  get(key: string): Promise<StoredObject | null>
  put(key: string, body: Uint8Array, options?: ObjectWriteOptions): Promise<{ etag: string | null }>
  delete(key: string): Promise<void>
}
