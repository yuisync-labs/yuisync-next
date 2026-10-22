const pending=new Set(['queued','running','waiting_quota'])
export const lunaTurnLabels={queued:'Aguardando execução',running:'Executando',waiting_quota:'Aguardando quota',complete:'Concluído',failed:'Falhou',requires_reconciliation:'Requer reconciliação'}

function abortError(){return new DOMException('Consulta interrompida; turno persistido.', 'AbortError')}
function waitForVisibility(signal){
 return new Promise((resolve,reject)=>{
  const clean=()=>{document.removeEventListener('visibilitychange',changed);signal?.removeEventListener('abort',aborted)}
  const changed=()=>{if(!document.hidden){clean();resolve()}}
  const aborted=()=>{clean();reject(abortError())}
  document.addEventListener('visibilitychange',changed);signal?.addEventListener('abort',aborted,{once:true})
  if(signal?.aborted)aborted();else changed()
 })
}
function waitForDelay(ms,signal){
 return new Promise((resolve,reject)=>{
  const aborted=()=>{clearTimeout(timer);reject(abortError())}
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve()},ms)
  signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted()
 })
}
export async function waitForLunaTurn({fetchStatus,onStatus=()=>{},signal,visible=()=>!document.hidden,waitVisible=()=>waitForVisibility(signal),sleep=ms=>waitForDelay(ms,signal)}){
 let previous=null,delay=2000
 for(;;){
  if(signal?.aborted)throw abortError()
  if(!visible())await waitVisible()
  // A visibility transition during a timer does not authorize another query.
  if(!visible())continue
  if(signal?.aborted)throw abortError()
  const job=await fetchStatus()
  onStatus(job)
  if(job.status==='complete')return job.result?.data??job.result
  if(!pending.has(job.status))throw new Error((job.errorCode||lunaTurnLabels[job.status]||'LUNA_TURN_UNKNOWN')+' — turno preservado; não reenvie.')
  delay=job.status===previous?Math.min(10000,delay+2000):2000
  previous=job.status
  await sleep(delay)
 }
}
