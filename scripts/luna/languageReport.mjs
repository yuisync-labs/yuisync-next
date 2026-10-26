// Turns the battery evidence (.artifacts/luna-language/**/case-*.json) into a
// short Markdown report: one row per case plus the transcript of each failure.
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
const root='.artifacts/luna-language',catalogue=JSON.parse(await readFile('docs/luna-think-language-cases.json','utf8'))
const request=JSON.parse(await readFile('.github/luna-language-request.json','utf8')),evidence=[]
async function walk(path){if(!existsSync(path))return;for(const f of await readdir(path,{withFileTypes:true})){const p=join(path,f.name);if(f.isDirectory())await walk(p);else if(/^case-\d+\.json$/.test(f.name))evidence.push(JSON.parse(await readFile(p,'utf8')))}}
await walk(root)
const caseNumber=id=>2000+Number(id.split('-')[1])*100+Number(id.split('-')[2])+(id.startsWith('FLOW')?5000:0)
const clip=(text,n)=>{const t=String(text??'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n)+'…':t}
const rows=request.cases.map(id=>{
 const s=catalogue.cases.find(c=>c.id===id),e=evidence.find(x=>x.languageCaseId===id)??evidence.find(x=>x.id===caseNumber(id))
 const usage=(e?.turns??[]).map(t=>t.result?.result?.usage).filter(Boolean)
 return {id,family:s?.family,name:s?.name,status:!e?'not_run':e.status==='passed'?'passed':e.status==='failed'?'failed':'incomplete',error:e?.error,turns:e?.turns??[],
  neurons:usage.reduce((n,u)=>n+(u.promptTokens??0)*0.0055+(u.completionTokens??0)*0.0364,0),calls:usage.reduce((n,u)=>n+(u.modelCalls??0),0)}
})
const stop=existsSync(join(root,'stop.json'))?JSON.parse(await readFile(join(root,'stop.json'),'utf8')):null
const count=s=>rows.filter(r=>r.status===s).length,neurons=rows.reduce((n,r)=>n+r.neurons,0)
const lines=[`## Bateria real da Luna`,'',`**${count('passed')} de ${rows.length} passaram** · ${count('failed')} falharam · ${count('incomplete')+count('not_run')} sem resultado · ${neurons.toFixed(0)} neurons em ${rows.reduce((n,r)=>n+r.calls,0)} chamadas ao modelo`,...(stop?['',`Parou porque o Workers AI recusou: **${stop.code}** (neurons gratuitos do dia acabaram).`]:[]),'','| Caso | Assunto | Resultado | Neurons |','| --- | --- | --- | --- |',
 ...rows.map(r=>`| ${r.id} | ${r.name??r.family} | ${{passed:'✅ passou',failed:'❌ falhou',incomplete:'⚠️ incompleto',not_run:'⏭️ não rodou'}[r.status]} | ${r.neurons.toFixed(0)} |`)]
for(const r of rows.filter(r=>r.status!=='passed'&&r.turns.length)){
 lines.push('',`<details><summary>${r.id}: ${clip(r.error,160)}</summary>`,'')
 for(const t of r.turns){lines.push(`- **Cliente:** ${clip((t.messages??[]).join(' / '),200)}`,`  **Luna (${t.result?.result?.status??t.result?.status}):** ${clip(t.result?.result?.reply,400)}`,...(t.handoffReason&&(t.result?.result?.status==="handoff")?[`  _Motivo do handoff:_ ${clip(t.handoffReason,200)}`]:[]),...(t.trace??[]).map(x=>`  - \`${x.tool}\` ${clip(x.input,160)} → ${clip(x.result,200)}`))}
 lines.push('','</details>')
}
const md=lines.join('\n').slice(0,60000)
await writeFile(join(root,'report.md'),md);await writeFile(join(root,'report.json'),JSON.stringify(rows,null,2))
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,md,{flag:'a'})
console.log(JSON.stringify({passed:count('passed'),failed:count('failed'),total:rows.length,neurons:Math.round(neurons)}))
