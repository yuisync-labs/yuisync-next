// Posts the staging D1 queries that read the most rows in the last day as a PR
// comment, since this repo's agents cannot read Actions logs. String and number
// literals are masked: the repository is public and staging holds real data.
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'

const raw=execFileSync('npx',['wrangler','d1','insights','yuisync-next-staging','--env','staging','--sort-by=reads','--time-period=1d','--limit=15','--json'],{cwd:'apps/edge-api',encoding:'utf8'})
const rows=JSON.parse(raw.slice(raw.indexOf('[')))
const mask=sql=>String(sql).replace(/'(?:[^']|'')*'/g,"'…'").replace(/\b\d{3,}\b/g,'N').replace(/\s+/g,' ').slice(0,400)
const num=v=>typeof v==='number'?Math.round(v).toLocaleString('pt-BR'):String(v??'')
const keys=rows[0]?Object.keys(rows[0]).filter(k=>k!=='query'&&!/time|Time|Ms|ms/.test(k)):[]
const lines=['## Consultas do D1 staging que mais leram (últimas 24h)','',`| ${keys.join(' | ')} | consulta |`,`|${keys.map(()=>' ---:').join('|')}| --- |`,...rows.map(r=>`| ${keys.map(k=>num(r[k])).join(' | ')} | \`${mask(r.query).replace(/\|/g,'\\|').replace(/`/g,"'")}\` |`)]
writeFileSync('d1-insights.md',lines.join('\n')+'\n')
console.log(lines.join('\n'))
