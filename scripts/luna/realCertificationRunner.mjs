// Certification orchestration only: never imported by the application build.
// A staging adapter must execute the native Worker, expose actual provider/D1
// metrics, enforce reserved upper bounds and reconcile ambiguous turns.
// Missing capabilities fail before any request; they are not mock successes.
import { createHash } from 'node:crypto'
export const certificationManifestHash = scenarios => createHash('sha256').update(JSON.stringify(scenarios)).digest('hex')
export const LUNA_CERTIFICATION_LIMITS = Object.freeze({ calls: 120, tokens: 250000, rowsRead: 100000 })
const integer = value => Number.isSafeInteger(value) && value >= 0
const sanitize = value => {
  if(typeof value==='string'&&/^[\[{]/.test(value.trim())){try{return JSON.stringify(sanitize(JSON.parse(value)))}catch{/* ordinary text */}}
  if (typeof value === 'string') return value.replace(/\b(?:gsk_|cfut_|sk_live_|sk_test_)[A-Za-z0-9_-]+/g,'[secret]').replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[email]').replace(/\b\d{10,15}\b/g,'[phone]')
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key])=>!['reasoning','reasoning_content','authorization','apiKey'].includes(key)).map(([key,item])=>[key,sanitize(item)]))
  return value
}
const fail = code => { throw new Error(code) }
function validateMetrics(metrics, bound) {
  if (!metrics || !['calls','tokens','rowsRead'].every(key=>integer(metrics[key]))) fail('CERTIFICATION_METRICS_UNAVAILABLE')
  if (Object.keys(LUNA_CERTIFICATION_LIMITS).some(key=>metrics[key]>bound[key])) fail('CERTIFICATION_BOUND_EXCEEDED')
}
function validateEvidence(result) {
  const arrays=['messages','toolCalls','toolResults','events','proposals','presentations','confirmations','commits','fallbacks']
  if (!result || arrays.some(key=>!Array.isArray(result[key])) || !result.stateBefore || !result.stateAfter || !result.checkpoint) fail('CERTIFICATION_EVIDENCE_INCOMPLETE')
  if (!result.validation || result.validation.passed !== true || !Array.isArray(result.validation.violations) || result.validation.violations.length) fail('CERTIFICATION_CHECKPOINT_FAILED')
}
/**
 * store.load/save is durable compare-and-swap: save(expectedVersion,next) must
 * return false on a competing writer. The adapter holds the reserved ceilings
 * across every model call and SQL query, including retries and fixture faults.
 * It must NOT retry a commit simply because this client lost an HTTP response.
 */
export async function runRealCertification({ sha, roundId, gates, offline, scenarios, store, adapter }) {
  if (!sha || offline?.sha!==sha || offline?.passed!==20 || offline?.executed!==20 || gates?.sha!==sha || gates?.passed!==true) fail('CERTIFICATION_LOCAL_GATES_REQUIRED')
  if (!Array.isArray(scenarios) || scenarios.length!==20 || new Set(scenarios.map(s=>s.id)).size!==20 || scenarios.some(s=>!integer(s.id)||s.id<1||s.id>20||!Array.isArray(s.messages)||!s.messages.length)) fail('CERTIFICATION_SCENARIOS_INVALID')
  const manifestHash=certificationManifestHash(scenarios)
  if(offline.manifestHash!==manifestHash)fail('CERTIFICATION_MANIFEST_MISMATCH')
  if (adapter?.environment!=='staging' || adapter?.isolated!==true || adapter?.fixtureOnly!==true || adapter?.releaseSha!==sha || adapter?.whatsappEnabled!==false) fail('CERTIFICATION_STAGING_REQUIRED')
  for (const method of ['bound','runTurn','reconcileTurn']) if(typeof adapter[method]!=='function') fail('CERTIFICATION_ADAPTER_INCOMPLETE')
  if(typeof store?.load!=='function'||typeof store?.save!=='function') fail('CERTIFICATION_DURABLE_STORE_REQUIRED')
  let state=await store.load(roundId)
  if(!state) state={roundId,sha,manifestHash,configurationFingerprint:adapter.configurationFingerprint??null,model:adapter.model??null,provider:adapter.provider??null,version:0,usage:{calls:0,tokens:0,rowsRead:0},reserved:{calls:0,tokens:0,rowsRead:0},pending:null,scenarios:{},status:'running'}
  if(state.sha!==sha||state.roundId!==roundId||state.manifestHash!==manifestHash) fail('CERTIFICATION_CHECKPOINT_SHA_MISMATCH')
  if(adapter.configurationFingerprint&&(state.configurationFingerprint!==adapter.configurationFingerprint||state.model!==adapter.model||state.provider!==adapter.provider))fail('CERTIFICATION_CHECKPOINT_CONFIGURATION_MISMATCH')
  async function persist(next){
    const value={...next,version:state.version+1}
    if(!await store.save(state.version,value))fail('CERTIFICATION_CHECKPOINT_CONFLICT')
    state=value
  }
  async function accept(result,pending){
    // Accounting is checked before the conversational verdict. Failed cases
    // still consume budget; never silently refund an API call or a SQL read.
    try{validateMetrics(result?.metrics,pending.bound)}catch(error){await persist({...state,status:'incomplete',accountingError:error.message});throw error}
    const usage=Object.fromEntries(Object.keys(LUNA_CERTIFICATION_LIMITS).map(key=>[key,state.usage[key]+result.metrics[key]]))
    const item=state.scenarios[pending.scenarioId]??{nextTurn:0,status:'running',transcript:[],checkpoint:null}
    let error=null;try{validateEvidence(result)}catch(failure){error=failure.message}
    const next={...item,nextTurn:error?item.nextTurn:pending.turn+1,status:error?'failed':'running',checkpoint:result.checkpoint??item.checkpoint,transcript:[...item.transcript,sanitize({turn:pending.turn,idempotencyKey:pending.key,result})]}
    await persist({...state,usage,reserved:{calls:0,tokens:0,rowsRead:0},pending:null,scenarios:{...state.scenarios,[pending.scenarioId]:next},status:error?'incomplete':'running'})
    if(error)fail(error)
  }
  // A crash retains its reservation and key. Only reconciliation can produce
  // an answer; an ambiguous request is never blindly submitted a second time.
  if(state.pending){
    const result=await adapter.reconcileTurn(state.pending.key)
    if(!result){await persist({...state,status:'incomplete'});return sanitize(state)}
    await accept(result,state.pending)
  }
  for(const scenario of [...scenarios].sort((a,b)=>a.id-b.id)){
    let item=state.scenarios[scenario.id]??{nextTurn:0,status:'running',transcript:[],checkpoint:null}
    if(item.status==='complete')continue
    if(item.status==='failed'){await persist({...state,status:'incomplete'});return sanitize(state)}
    for(let turn=item.nextTurn;turn<scenario.messages.length;turn++){
      const bound=await adapter.bound({scenario,turn,checkpoint:item.checkpoint})
      if(!bound||!Object.keys(LUNA_CERTIFICATION_LIMITS).every(key=>integer(bound[key])))fail('CERTIFICATION_BOUND_UNAVAILABLE')
      if(Object.keys(LUNA_CERTIFICATION_LIMITS).some(key=>state.usage[key]+bound[key]>LUNA_CERTIFICATION_LIMITS[key])){
        await persist({...state,status:'budget_exhausted'});return sanitize(state)
      }
      const key=`${roundId}:${sha}:${scenario.id}:${turn}`
      const pending={scenarioId:scenario.id,turn,key,bound}
      await persist({...state,status:'running',reserved:bound,pending})
      let result
      try{result=await adapter.runTurn({scenario,turn,message:scenario.messages[turn],checkpoint:item.checkpoint,idempotencyKey:key,limits:bound})}
      catch(error){await persist({...state,status:'incomplete',transportError:typeof error?.code==='string'?error.code:'TURN_RESPONSE_UNCERTAIN'});return sanitize(state)}
      await accept(result,pending)
      item=state.scenarios[scenario.id]
    }
    await persist({...state,scenarios:{...state.scenarios,[scenario.id]:{...item,status:'complete'}}})
  }
  // Transactional acceptance is not a substitute for transcript review.
  await persist({...state,status:'awaiting_transcript_review'})
  return sanitize(state)
}
