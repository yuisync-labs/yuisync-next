import {useEffect,useState} from 'react'
import {getChatQuality,reviewChatQuality} from '../../../lib/api'
export default function ChatQualityInbox({tenantId,moduleId,onOpen}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[busy,setBusy]=useState(''),[notes,setNotes]=useState({})
 useEffect(()=>{setOffset(0);setNotes({});setData(null)},[tenantId,moduleId])
 useEffect(()=>{
  if(!tenantId)return
  const controller=new AbortController();setError('');setData(null)
  getChatQuality({tenantId,moduleId,offset,signal:controller.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message)})
  return()=>controller.abort()
 },[tenantId,moduleId,offset])
 async function review(item){
  setBusy(item.id);setError('')
  try{await reviewChatQuality(item.id,{tenantId,moduleId,status:'reviewed',notes:notes[item.id]??item.quality_review.notes??''});setData(await getChatQuality({tenantId,moduleId,offset}))}catch(e){setError(e.message)}finally{setBusy('')}
 }
 return <section aria-label="Controle de qualidade das avaliações" className="border-b border-[var(--border2)] p-4 max-h-[55vh] overflow-y-auto">
  <h2 className="font-bold">Avaliações de atendimento</h2>
  <p className="text-sm text-muted mb-3">Confira a nota do cliente e registre a revisão do atendimento.</p>
  {error&&<p role="alert" className="text-red-400">{error}</p>}
  {!data&&!error&&<p role="status">Carregando avaliações…</p>}
  {data?.items.length===0&&<p className="text-sm text-muted">Nenhuma avaliação recebida nesta página.</p>}
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
   {data?.items.map(item=><article key={item.id} className="border border-[var(--border2)] rounded-xl p-3">
    <div className="flex justify-between gap-2"><strong>{item.customer_name||'Cliente'}</strong><span aria-label={`Nota ${item.csat_score} de 5`}>{item.csat_score}/5</span></div>
    <p className="text-xs text-muted mt-1">{item.quality_review.status==='reviewed'?'Revisado':'Revisão pendente'}{item.csat_score<=2?' · Atenção à nota baixa':''}</p>
    <button className="text-sm underline mt-2" onClick={()=>onOpen(item)}>Abrir conversa</button>
    {data.canReview&&<><label className="block text-xs mt-2" htmlFor={`quality-${item.id}`}>Observação da revisão</label><textarea id={`quality-${item.id}`} className="inp w-full mt-1" maxLength={1000} value={notes[item.id]??item.quality_review.notes??''} onChange={e=>setNotes({...notes,[item.id]:e.target.value})}/><button className="btn btn-secondary btn-sm mt-2" disabled={busy===item.id} onClick={()=>review(item)}>{busy===item.id?'Salvando…':'Marcar como revisado'}</button></>}
   </article>)}
  </div>
  {data&&<div className="flex gap-2 mt-3"><button className="btn btn-secondary btn-sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Anteriores</button><button className="btn btn-secondary btn-sm" disabled={!data.hasMore} onClick={()=>setOffset(offset+50)}>Próximas</button></div>}
 </section>
}
