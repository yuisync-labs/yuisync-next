const pending=new Set(['queued','running','waiting_quota'])
export const lunaTurnLabels={queued:'Aguardando execução',running:'Executando',waiting_quota:'Aguardando quota',complete:'Concluído',failed:'Falhou',requires_reconciliation:'Requer reconciliação'}

export async function waitForLunaTurn({fetchStatus,onStatus=()=>{},visible=()=>!document.hidden,waitVisible=()=>new Promise(resolve=>{const changed=()=>{if(!document.hidden){document.removeEventListener('visibilitychange',changed);resolve()}};document.addEventListener('visibilitychange',changed);changed()}),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let previous=null,delay=2000
 for(;;){
  if(!visible())await waitVisible()
  // A visibility transition during a timer does not authorize another query.
  if(!visible())continue
  const job=await fetchStatus()
  onStatus(job)
  if(job.status==='complete')return job.result?.data??job.result
  if(!pending.has(job.status))throw new Error((job.errorCode||lunaTurnLabels[job.status]||'LUNA_TURN_UNKNOWN')+' — turno preservado; não reenvie.')
  delay=job.status===previous?Math.min(10000,delay+2000):2000
  previous=job.status
  await sleep(delay)
 }
}
