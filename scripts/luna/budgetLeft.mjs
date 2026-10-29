// Prints the USD a paid run may spend: what the request asks for, never more
// than what is left of the total limit in .github/luna-spend-ledger.json.
import {readFileSync} from 'node:fs'
const ledger=JSON.parse(readFileSync('.github/luna-spend-ledger.json','utf8')),request=JSON.parse(readFileSync(process.argv[2],'utf8'))
const left=ledger.limit_usd-ledger.runs.reduce((n,r)=>n+r.usd,0),asked=Number(request.budget_usd??left)
const budget=Math.max(0,Math.min(asked,left))
if(!(budget>0.02)){console.error(`Sem saldo: limite US$ ${ledger.limit_usd}, restam US$ ${left.toFixed(4)}`);process.exit(1)}
console.log(budget.toFixed(4))
