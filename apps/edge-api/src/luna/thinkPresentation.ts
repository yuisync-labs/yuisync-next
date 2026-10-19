const normalized=(v:string)=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
export function zonedIsoTime(value:string,timezone:string){
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(new Date(value))
  const part=(type:string)=>parts.find(p=>p.type===type)?.value??''
  const raw=part('timeZoneName').replace(/^(?:GMT|UTC)/,'').replace(/\u2212/g,'-'),offset=!raw||raw==='+00:00'||raw==='-00:00'?'Z':raw
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${offset}`
}
export function validateThinkReply(reply:string,results:readonly {name:string;result:unknown}[]){
  const prices=new Set<number>(),budgets=new Set<number>();let hasStock=false,positiveStock=false,hasSlots=false,queriedSlots=false
  const hours=new Set<string>(),ranges=new Set<string>(),durations=new Set<number>()
  const visit=(v:unknown)=>{if(Array.isArray(v)){v.forEach(visit);return}if(!v||typeof v!=='object')return;const row=v as Record<string,unknown>;for(const [k,value] of Object.entries(v)){if(k.endsWith('_cents')&&typeof value==='number')prices.add(value);if(k==='maxPriceCents'&&typeof value==='number')budgets.add(value);if((k==='available_milliunits'||k==='available_quantity')&&typeof value==='number'){hasStock=true;positiveStock ||= value>0}if(k==='slots'&&Array.isArray(value))queriedSlots=true;if(k==='slots'&&Array.isArray(value)&&value.length){hasSlots=true;for(const slot of value)if(typeof slot==='string'&&typeof row.timezone==='string'){try{const format=new Intl.DateTimeFormat('en-GB',{timeZone:row.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),start=new Date(slot),hour=format.format(start);hours.add(hour);if(typeof row.duration_minutes==='number'&&row.duration_minutes>0){durations.add(row.duration_minutes);ranges.add(hour+'-'+format.format(new Date(start.getTime()+row.duration_minutes*60000)))}}catch{}}}visit(value)}}
  results.forEach(r=>visit(r.result))
  for(const m of reply.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)|\b(\d+(?:[.,]\d{1,2})?)\s*reais\b/gi)){const raw=m[1]??m[2];const amount=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;const cents=Math.round(Number(amount)*100);const isBudget=/\b(?:ate|limite de|orcamento de|maximo de)\s*$/.test(normalized(reply.slice(Math.max(0,m.index-30),m.index)));if(!prices.has(cents)&&!(isBudget&&budgets.has(cents)))return {ok:false,reason:'UNSUPPORTED_PRICE'}}
  const text=normalized(reply)
  if(/pagamento (?:confirmado|recebido)|pix (?:gerado|confirmado)|chave pix/.test(text))return {ok:false,reason:'PAYMENT_NOT_INTEGRATED'}
  if(/(?:entrega(?:mos)?|chega(?:ra)?|sai para entrega) (?:hoje|amanha)|entrega entre \d/.test(text))return {ok:false,reason:'DELIVERY_WINDOW_UNVERIFIED'}
  if(!hasStock&&/\b(?:em estoque|temos estoque|disponivel em estoque|acabou|esgotad[oa])\b/.test(text))return {ok:false,reason:'STOCK_UNVERIFIED'}
  if(hasStock&&!positiveStock&&!/\bnao\b/.test(text)&&/\b(?:disponivel|temos estoque|em estoque)\b/.test(text))return {ok:false,reason:'STOCK_ZERO'}
  const slotClaims=queriedSlots?text.replace(/\bnao (?:ha|tenho|temos|tem|encontrei)\s+(?:(?:um|nenhum)\s+)?(?:vaga|horario)(?:\s+(?:livre|disponivel))?/g,''):text
  if(!hasSlots&&/\b(?:tenho|temos) (?:vaga|horario)|horario (?:livre|disponivel)/.test(slotClaims))return {ok:false,reason:'SLOT_UNVERIFIED'}
  if(hasSlots&&hours.size){
    const clock=(h:string,m?:string)=>h.padStart(2,'0')+':'+(m??'00')
    let invalidRange=false
    const rest=text.replace(/\b(\d{1,2})(?:h(\d{2})?|:(\d{2}))\s*(?:as|ate|[-–])\s*(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?!\d|[a-z])/g,(_all,h,m,n,endH,endM,endN)=>{if(!ranges.has(clock(h,m??n)+'-'+clock(endH,endM??endN)))invalidRange=true;return ''})
    if(invalidRange)return {ok:false,reason:'SLOT_NOT_RETURNED'}
    for(const m of rest.matchAll(/\b(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?!\d|[a-z])/g)){
      const hour=clock(m[1],m[2]??m[3]),duration=/\b(?:duracao(?: de)?|dura|leva|aproximadamente|cerca de)\s*$/.test(rest.slice(0,m.index))
      if(duration&&durations.has(Number(m[1])*60+Number(m[2]??m[3]??0)))continue
      const before=rest.slice(Math.max(0,m.index-70),m.index),after=rest.slice(m.index+m[0].length)
      const unavailable=/(?:nao (?:ha|temos|tenho|tem|encontrei)\s*(?:vaga|horario)?\s*(?:as|para|de)?|sem (?:vaga|disponibilidade)\s*(?:as)?|(?:horario|vaga) (?:ocupad[oa]|indisponivel)\s*(?:as)?)\s*$/.test(before)||/^\s*(?:esta |estao |ja esta )?(?:ocupad[oa]|indisponivel|sem vaga)\b/.test(after)
      if(!hours.has(hour)&&!unavailable)return {ok:false,reason:'SLOT_NOT_RETURNED',unverifiedHour:hour}
    }
  }
  return {ok:true}
}
