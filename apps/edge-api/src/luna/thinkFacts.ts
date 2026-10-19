// Model-facing projection only. Domain results and their validation stay intact.
// Missing fields remain unknown; false, zero and empty result lists are facts.
export function compactThinkFacts(value:unknown):unknown {
  if(Array.isArray(value))return value.map(compactThinkFacts)
  if(!value||typeof value!=='object')return value
  const row=value as Record<string,unknown>,out:Record<string,unknown>={}
  for(const [key,item] of Object.entries(row)){
    if(item===null||item===undefined)continue
    if(key==='available_milliunits'&&typeof item==='number'){out.available_quantity=item/1000;continue}
    // The selected refinement already contains the relevant alternatives.
    if(key==='facets'&&row.refinement)continue
    if(key==='attributes_json'&&typeof item==='string'){
      try{
        const attributes=JSON.parse(item)
        if(attributes&&typeof attributes==='object'&&!Array.isArray(attributes)){
          const extra=Object.fromEntries(Object.entries(attributes).filter(([name,field])=>field!=null&&!(name in row&&JSON.stringify(row[name])===JSON.stringify(field))))
          if(Object.keys(extra).length)out.attributes=compactThinkFacts(extra)
          continue
        }
      }catch{/* Retain malformed source verbatim rather than turn it into facts. */}
    }
    out[key]=compactThinkFacts(item)
  }
  return out
}
