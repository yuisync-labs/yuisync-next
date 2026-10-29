// Turns the simulator evidence (.artifacts/luna-simulator/case-*.json) into a
// Markdown report: the score against the release criterion, failures grouped by
// kind, what the run cost and the transcript of each failed conversation.
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
const root='.artifacts/luna-simulator/',rows=[]
if(existsSync(root))for(const f of await readdir(root))if(/^case-\d+\.json$/.test(f)){const e=JSON.parse(await readFile(root+f,'utf8'));if(e.kind==='simulator')rows.push(e)}
rows.sort((a,b)=>a.id-b.id)
const spend=existsSync(root+'spend.json')?JSON.parse(await readFile(root+'spend.json','utf8')):{spent_usd:0,budget_usd:0}
const ledger=JSON.parse(await readFile('.github/luna-spend-ledger.json','utf8'))
const left=ledger.limit_usd-ledger.runs.reduce((n,r)=>n+r.usd,0)-spend.spent_usd
const clip=(text,n)=>{const t=String(text??'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n)+'…':t}
const n=rows.length,passed=rows.filter(r=>r.status==='passed').length,grave=rows.filter(r=>r.status==='grave').length
const pct=v=>n?Math.round(v/n*100)+'%':'—'
const noReason=rows.filter(r=>r.problems.some(p=>p.startsWith('passou para a loja sem motivo'))).length,repeated=rows.filter(r=>r.repeated).length
const kinds={};for(const r of rows)for(const p of [...r.grave.map(g=>'GRAVE: '+g),...r.problems]){const k=p.split(':')[0];kinds[k]=(kinds[k]??0)+1}
const goals={};for(const r of rows){const g=goals[r.scenario.goal]??={n:0,ok:0};g.n++;if(r.status==='passed')g.ok++}
const lines=['## Simulador de clientes da Luna','',
 `**${passed} de ${n} conversas certas (${pct(passed)})** · meta 95% · ${grave} com erro grave (meta 0) · ${noReason} passaram para a loja sem motivo (${pct(noReason)}, meta < 3%) · pergunta repetida em ${repeated} (${pct(repeated)}, meta < 5%)`,'',
 `Gasto desta rodada: **US$ ${spend.spent_usd.toFixed(4)}** de US$ ${spend.budget_usd.toFixed(2)} liberados · saldo do limite total de US$ ${ledger.limit_usd.toFixed(2)}: **US$ ${left.toFixed(4)}**`+(spend.stopped?` · parou: **${spend.stopped}**`:''),'',
 '| Objetivo | Conversas | Certas |','| --- | ---: | ---: |',...Object.entries(goals).sort((a,b)=>b[1].n-a[1].n).map(([g,v])=>`| ${g} | ${v.n} | ${v.ok} |`),'',
 '| Tipo de falha | Vezes |','| --- | ---: |',...Object.entries(kinds).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`| ${clip(k,80)} | ${v} |`),'']
for(const r of rows.filter(r=>r.status!=='passed')){
 lines.push(`<details><summary>${r.scenario.id} · ${r.scenario.goal} · ${r.status==='grave'?'❗ grave':'❌'} ${clip([...r.grave,...r.problems].join('; '),160)}</summary>`,'',`Estilo: ${r.scenario.style}. Desvio: ${r.scenario.detour}.`,'')
 for(const l of r.lines)lines.push(`- **${l.from==='cliente'?'Cliente':'Luna'}${l.status&&l.status!=='replied'?' ('+l.status+')':''}:** ${clip(l.text,260)}`)
 if(r.judge?.comment)lines.push('',`Avaliador: ${clip(r.judge.comment,200)}`)
 lines.push('','</details>','')
}
let report=lines.join('\n');if(report.length>60000)report=report.slice(0,60000)+'\n\n(relatório cortado; o restante está no artefato da execução)'
await writeFile(root+'report.md',report)
