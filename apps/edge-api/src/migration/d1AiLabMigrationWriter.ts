const PROJECTION = 'phase8-ai-lab/v1'
const MAX_BATCH = 40

type Row = Record<string, unknown>
type Spec = Readonly<{ columns: readonly string[]; key: readonly string[]; scoped: boolean }>

const TABLES: Readonly<Record<string, Spec>> = Object.freeze({
  ai_niches: {
    columns: ['id','name','base_prompt','created_at_ms','updated_at_ms'],
    key: ['id'], scoped: false,
  },
  ai_companies: {
    columns: ['tenant_id','module_id','id','niche_id','name','system_prompt','bot_name','temperature_milli','model_name','welcome_message','kb_namespace','status','schedule_free_status','schedule_booked_status','created_at_ms','updated_at_ms'],
    key: ['tenant_id','module_id','id'], scoped: true,
  },
  ai_prompt_versions: {
    columns: ['tenant_id','module_id','id','company_id','layer','content','version','is_active','changed_by','change_note','created_at_ms'],
    key: ['tenant_id','module_id','id'], scoped: true,
  },
  ai_training_documents: {
    columns: ['tenant_id','module_id','id','company_id','title','object_key','mime_type','file_size','content_text','tags_json','status','metadata_json','uploaded_by','created_at_ms','updated_at_ms'],
    key: ['tenant_id','module_id','id'], scoped: true,
  },
  ai_playground_runs: {
    columns: ['tenant_id','module_id','id','company_id','created_by','customer_phone','input_message','parsed_intent_json','action','reply','raw_response_json','created_at_ms'],
    key: ['tenant_id','module_id','id'], scoped: true,
  },
})

export type AiLabMigrationWriterErrorCode = 'INVALID_SNAPSHOT'|'DESTINATION_DIVERGED'|'DATABASE_UNAVAILABLE'|'WRITE_FAILED'
export class AiLabMigrationWriterError extends Error {
  readonly code: AiLabMigrationWriterErrorCode
  constructor(code: AiLabMigrationWriterErrorCode) { super('AI Lab migration could not be applied.'); this.name='AiLabMigrationWriterError'; this.code=code }
}

function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
  return value as Row
}
function scalar(value: unknown): string|number|null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value
  throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
}
function keyOf(row: Row, spec: Spec): string { return JSON.stringify(spec.key.map((column) => scalar(row[column]))) }
function same(left: Row, right: Row, spec: Spec): boolean { return spec.columns.every((column) => scalar(left[column]) === scalar(right[column])) }

function validateSnapshot(snapshot: unknown) {
  const root=object(snapshot)
  if (root.projection !== PROJECTION) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
  const scope=object(root.scope)
  const tenantId=String(scope.tenant_id||'').trim()
  const moduleId=String(scope.module_id||'').trim().toLowerCase()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(tenantId) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(moduleId)) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
  const collections=object(root.collections)
  const projected: Record<string,Row[]> = {}
  for (const [table,spec] of Object.entries(TABLES)) {
    const rows=collections[table]
    if (!Array.isArray(rows)) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
    const seen=new Set<string>()
    projected[table]=rows.map((raw) => {
      const row=object(raw)
      if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...spec.columns].sort())) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
      if (spec.scoped && (row.tenant_id !== tenantId || row.module_id !== moduleId)) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT')
      for (const column of spec.columns) scalar(row[column])
      const key=keyOf(row,spec); if(seen.has(key)) throw new AiLabMigrationWriterError('INVALID_SNAPSHOT'); seen.add(key)
      return row
    })
  }
  return { tenantId,moduleId,collections:projected }
}

async function destinationRows(database:D1Database, table:string, spec:Spec, tenantId:string, moduleId:string):Promise<Row[]> {
  try {
    const query=spec.scoped
      ? `SELECT ${spec.columns.join(',')} FROM ${table} WHERE tenant_id=?1 AND module_id=?2`
      : `SELECT ${spec.columns.join(',')} FROM ${table}`
    const statement=database.prepare(query)
    const result=spec.scoped ? await statement.bind(tenantId,moduleId).all<Row>() : await statement.all<Row>()
    return result.results
  } catch { throw new AiLabMigrationWriterError('DATABASE_UNAVAILABLE') }
}

async function preflight(database:D1Database, tenantId:string, moduleId:string, collections:Record<string,Row[]>) {
  const missing:Record<string,Row[]>={}
  for (const [table,spec] of Object.entries(TABLES)) {
    const destination=await destinationRows(database,table,spec,tenantId,moduleId)
    const sourceByKey=new Map(collections[table].map((row)=>[keyOf(row,spec),row]))
    const destByKey=new Map(destination.map((row)=>[keyOf(row,spec),row]))
    for (const [key,dest] of destByKey) {
      const source=sourceByKey.get(key)
      if (!source) {
        if (spec.scoped) throw new AiLabMigrationWriterError('DESTINATION_DIVERGED')
        continue
      }
      if (!same(source,dest,spec)) throw new AiLabMigrationWriterError('DESTINATION_DIVERGED')
    }
    missing[table]=collections[table].filter((row)=>!destByKey.has(keyOf(row,spec)))
  }
  return missing
}

function insert(database:D1Database, table:string, spec:Spec, row:Row):D1PreparedStatement {
  const placeholders=spec.columns.map((_,index)=>`?${index+1}`).join(',')
  return database.prepare(`INSERT INTO ${table}(${spec.columns.join(',')}) VALUES(${placeholders})`).bind(...spec.columns.map((column)=>scalar(row[column])))
}

export async function applyAiLabSnapshotToD1({ database, snapshot }:{ database?:D1Database; snapshot:unknown }) {
  if (!database) throw new AiLabMigrationWriterError('DATABASE_UNAVAILABLE')
  const validated=validateSnapshot(snapshot)
  const missing=await preflight(database,validated.tenantId,validated.moduleId,validated.collections)
  let inserted=0,batches=0
  for (const [table,spec] of Object.entries(TABLES)) {
    const statements=missing[table].map((row)=>insert(database,table,spec,row))
    for(let offset=0;offset<statements.length;offset+=MAX_BATCH){
      try { await database.batch(statements.slice(offset,offset+MAX_BATCH)) } catch { throw new AiLabMigrationWriterError('WRITE_FAILED') }
      inserted+=Math.min(MAX_BATCH,statements.length-offset);batches+=1
    }
  }
  return Object.freeze({status:'applied',tenantId:validated.tenantId,moduleId:validated.moduleId,insertedRows:inserted,batchCount:batches,rowCounts:Object.fromEntries(Object.entries(validated.collections).map(([name,rows])=>[name,rows.length]))})
}

export { TABLES as AI_LAB_TABLE_SPECS }
