import {readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const roots=process.argv.slice(2)
if(!roots.length)throw Error('EVIDENCE_ROOTS_REQUIRED')
const catalogue=JSON.parse(await readFile('docs/luna-think-language-cases.json','utf8'))
const baseline=JSON.parse(await readFile(roots[0]+'/original-report.json','utf8'))
const evidence=[baseline.evidence],budgets=[{run:39832266741,...baseline.budget_report_before_hold_release}],queues=[]
async function walk(path){for(const f of await readdir(path,{withFileTypes:true})){
 const p=join(path,f.name);if(f.isDirectory())await walk(p)
 else if(f.name==='budget-report.json')budgets.push({evidence_path:p,...JSON.parse(await readFile(p,'utf8'))})
 else if(/^case-\d+\.json$/.test(f.name))evidence.push({...JSON.parse(await readFile(p,'utf8')),evidence_path:p})
 else if(f.name==='queue-report.json')queues.push(JSON.parse(await readFile(p,'utf8')))
}}
for(const root of roots.slice(1))await walk(root)
const results=catalogue.cases.map(s=>{
 const es=evidence.filter(e=>e.languageCaseId===s.id||e.id===2000+Number(s.id.split('-')[1])*100+Number(s.id.split('-')[2]))
 const e=es.at(-1),hasTurn=Boolean(e?.turns?.length)
 let status=!e?'not_run':e.status==='passed'?'passed':e.status==='blocked'?'blocked':e.status==='failed'&&hasTurn?'failed':'incomplete'
 if(s.family==='date_boundary')status='blocked'
 return {id:s.id,family:s.family,status,real_turn_evidence:hasTurn,reason:s.family==='date_boundary'?'CONTROLLED_STORE_CLOCK_NOT_VALIDATED':e?.error??e?.reason??(e?'INCOMPLETE_EVIDENCE':'NOT_REACHED'),evidence:es}
})
const counts=Object.fromEntries(['passed','failed','blocked','incomplete','not_run'].map(s=>[s,results.filter(r=>r.status===s).length]))
const usage=evidence.flatMap(e=>e.turns??[]).map(t=>t.result?.result?.usage).filter(Boolean)
const report={schema_version:2,date:'2026-10-22',specified:36,summary:{...counts,with_real_turn_evidence:results.filter(r=>r.real_turn_evidence).length},quota:{allocation:10000,daily_stop:9000,batch_cap:1000,charged_neurons:budgets.reduce((n,b)=>n+(Number(b.spent)||0),0),last_counter:budgets.at(-1)?.counter,all_holds_released:budgets.every(b=>b.holdReleased),all_temporary_proxies_deleted:budgets.every(b=>b.proxyDeleted),counter_includes_safety_margin:true,reported_model_calls:usage.reduce((n,u)=>n+(Number(u.modelCalls)||0),0)},runtime_reference_sha:baseline.application_runtime_sha,application_code_changed:false,production_activated:false,assertion_policy:'Failures remain failures; blocked clock fixtures are not application failures or passes. Natural-language assertions require transcript review. No automatic inference retry.',budgets,queues,case_results:results}
await writeFile('docs/luna-think-language-results-20261022.json',JSON.stringify(report,null,2)+'\n')
const lines=['# Resultados das variantes de linguagem — 22/10/2026','',`Casos especificados: **36**. Aprovados integralmente: **${counts.passed}**; divergências: **${counts.failed}**; bloqueados: **${counts.blocked}**; incompletos: **${counts.incomplete}**; não alcançados: **${counts.not_run}**.`,'',`Consumo contabilizado dos testes: **${report.quota.charged_neurons.toFixed(4)} neurons**. Cada lote tem teto de 1.000 e a parada diária interna é de 9.000, dentro da cota de 10.000. O contador inclui margem de segurança e não representa a fatura exata da conta.`, '',`Reservas liberadas em todos os lotes: **${report.quota.all_holds_released?'sim':'não; verificar os relatórios'}**. Proxies temporários removidos: **${report.quota.all_temporary_proxies_deleted?'sim':'não; verificar os relatórios'}**.`,'','## Interpretação','', 'As fixtures usam Think e D1 locais isolados; os turnos de linguagem usam GLM-4.7-Flash nativo através do contador compartilhado do staging. Preparação determinística e testes locais não contam como interpretação aprovada pelo modelo. Nenhuma alteração foi feita no código da aplicação ou na ativação de produção.','', 'As divergências de confirmação não comprovam compra indevida: os primeiros casos permaneceram pendentes e pediram nova confirmação. No cenário de preço, o resumo continuou mostrando R$ 90 após o cadastro passar para R$ 95; é um problema de atualização do resumo, sem venda pelo preço antigo observada naquele desafio.','', 'Os três cenários de data estão bloqueados por uma limitação do executor: alterar Date.now globalmente não controla new Date no prompt e pode interferir nos alarmes nativos. Não são classificados como falha da Luna nem como aprovados. Asserções de texto são heurísticas; preservar o transcript e revisar antes de atribuir causa ao modelo.','', '## Casos','', '| Caso | Família | Resultado |','| --- | --- | --- |',...results.map(r=>`| ${r.id} | ${r.family} | ${r.status} |`),'','## Evidências','',...budgets.map(b=>`- Lote: ${b.evidence_path??'execução 39832266741'}; consumo: ${Number(b.spent??0).toFixed(4)} neurons.`),'- [PR 261](https://github.com/yuisync-labs/yuisync-next/pull/261).','- Registro completo e transcrições: `luna-think-language-results-20261022.json`.','']
await writeFile('docs/luna-think-language-results-20261022.md',lines.join('\n'))
console.log(JSON.stringify({summary:report.summary,quota:report.quota}))
