import test from 'node:test'
import assert from 'node:assert/strict'
import {runRealCertification,certificationManifestHash} from '../../scripts/luna/realCertificationRunner.mjs'
const sha='fixture-sha'
function fixture(){
 let checkpoint=null,calls=0,lost=false
 const results=new Map()
 const store={async load(){return structuredClone(checkpoint)},async save(version,next){if((checkpoint?.version??0)!==version)return false;checkpoint=structuredClone(next);return true}}
 const scenarios=Array.from({length:20},(_,i)=>({id:i+1,messages:[`Mensagem fictícia ${i+1}`]}))
 const result={metrics:{calls:1,tokens:20,rowsRead:7},messages:['fictício'],toolCalls:[],toolResults:[],events:[],proposals:[],presentations:[],confirmations:[],commits:[],fallbacks:[],stateBefore:{cart:[]},stateAfter:{cart:[]},checkpoint:{version:1},validation:{passed:true,violations:[]}}
 const adapter={environment:'staging',isolated:true,fixtureOnly:true,releaseSha:sha,whatsappEnabled:false,async bound(){return{calls:6,tokens:12000,rowsRead:500}},async runTurn(input){calls++;results.set(input.idempotencyKey,structuredClone(result));if(lost){lost=false;throw new Error('lost')}return structuredClone(result)},async reconcileTurn(key){return results.get(key)??null}}
 return{input:{sha,roundId:'fixture-round',offline:{sha,passed:20,executed:20,manifestHash:certificationManifestHash(scenarios)},gates:{sha,passed:true},scenarios,store,adapter},get calls(){return calls},get checkpoint(){return checkpoint},loseResponse(){lost=true},result}
}
test('recusa staging em SHA diferente antes da primeira chamada',async()=>{
 const f=fixture();f.input.adapter.releaseSha='old'
 await assert.rejects(runRealCertification(f.input),/CERTIFICATION_STAGING_REQUIRED/);assert.equal(f.calls,0)
})
test('retomada rejeita modelo/provider/configuração diferentes sem repetir chamadas',async()=>{
 const f=fixture();Object.assign(f.input.adapter,{configurationFingerprint:'config-v1',model:'openai/gpt-oss-20b',provider:'groq'})
 await runRealCertification(f.input);assert.equal(f.calls,20)
 f.input.adapter.configurationFingerprint='config-v2'
 await assert.rejects(runRealCertification(f.input),/CHECKPOINT_CONFIGURATION_MISMATCH/)
 assert.equal(f.calls,20)
})
test('não substitui os roteiros certificados por vinte mensagens diferentes',async()=>{
 const f=fixture();f.input.scenarios[0].messages=['outro roteiro']
 await assert.rejects(runRealCertification(f.input),/CERTIFICATION_MANIFEST_MISMATCH/);assert.equal(f.calls,0)
})
test('executa e retoma 20 cenários sem refazer os concluídos; revisão permanece pendente',async()=>{
 const f=fixture(),r=await runRealCertification(f.input)
 assert.equal(r.status,'awaiting_transcript_review');assert.equal(Object.keys(r.scenarios).length,20);assert.equal(f.calls,20)
 assert.deepEqual(r.usage,{calls:20,tokens:400,rowsRead:140})
 await runRealCertification(f.input);assert.equal(f.calls,20)
})
test('resposta perdida exige reconciliação, nunca repete a gravação',async()=>{
 const f=fixture();f.loseResponse()
 const first=await runRealCertification(f.input);assert.equal(first.status,'incomplete');assert.ok(first.pending);assert.equal(f.calls,1)
 const final=await runRealCertification(f.input);assert.equal(final.status,'awaiting_transcript_review');assert.equal(f.calls,20)
})
test('interrompe antes do teto reservado, mantendo casos não executados sem aprovação',async()=>{
 const f=fixture();f.input.adapter.bound=async()=>({calls:120,tokens:250000,rowsRead:100000})
 const r=await runRealCertification(f.input);assert.equal(r.status,'budget_exhausted');assert.equal(f.calls,1);assert.equal(r.scenarios[1].status,'complete');assert.equal(r.scenarios[2],undefined)
})
test('métrica ausente e evidência incompleta bloqueiam, não aprovam',async()=>{
 const f=fixture();delete f.result.metrics.rowsRead
 await assert.rejects(runRealCertification(f.input),/CERTIFICATION_METRICS_UNAVAILABLE/);assert.equal(f.checkpoint.status,'incomplete');assert.ok(f.checkpoint.pending)
 const g=fixture();delete g.result.stateBefore
 await assert.rejects(runRealCertification(g.input),/CERTIFICATION_EVIDENCE_INCOMPLETE/);assert.equal(g.checkpoint.scenarios[1].status,'failed');assert.deepEqual(g.checkpoint.usage,{calls:1,tokens:20,rowsRead:7})
})
