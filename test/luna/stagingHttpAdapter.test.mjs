import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createStagingHttpAdapter} from '../../scripts/luna/stagingHttpAdapter.mjs'
const capabilities={environment:'staging',isolated:true,fixtureOnly:true,whatsappEnabled:false,releaseSha:'fixture-sha',model:'configured-groq-model'}
const config={baseUrl:'https://staging.fixture.invalid/',token:'ephemeral-fake-token',sha:'fixture-sha',roundId:'fixture-round'}
test('verifies staging capabilities before enabling turns and scopes every body to round',async()=>{
 const calls=[]
 const {adapter,store}=await createStagingHttpAdapter({...config,fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options})
  return Response.json(calls.length===1?capabilities:{saved:true})
 }})
 assert.equal(calls.length,1)
 await store.save(0,{version:1})
 await adapter.runTurn({scenario:{id:1},turn:0,message:'exact canonical message',idempotencyKey:'key',limits:{calls:6,tokens:100000,rowsRead:20000}})
 assert.equal(JSON.parse(calls[2].options.body).roundId,'fixture-round')
 assert.equal(JSON.parse(calls[2].options.body).sha,'fixture-sha')
 assert.equal(calls[2].options.redirect,'error')
})
test('rejects the wrong SHA and nonisolated or enabled environments before a paid turn',async()=>{
 for(const change of [{releaseSha:'old'},{environment:'production'},{isolated:false},{fixtureOnly:false},{whatsappEnabled:true},{model:null}]){
  let count=0
  await assert.rejects(createStagingHttpAdapter({...config,fetchImpl:async()=>{count++;return Response.json({...capabilities,...change})}}),/CAPABILITIES_MISMATCH/)
  assert.equal(count,1)
 }
})
test('does not retry an ambiguous turn or leak secrets from errors',async()=>{
 let count=0
 const {adapter}=await createStagingHttpAdapter({...config,fetchImpl:async()=>{
  count++;if(count===1)return Response.json(capabilities)
  throw new Error(`sensitive ${config.token}`)
 }})
 await assert.rejects(adapter.runTurn({scenario:{id:1},turn:0}),error=>error.message==='CERTIFICATION_TRANSPORT_UNCERTAIN'&&!error.message.includes(config.token))
 assert.equal(count,2)
})
test('reconciles a lost response by receipt instead of repeating a turn',async()=>{
 const paths=[]
 const {adapter}=await createStagingHttpAdapter({...config,fetchImpl:async(url)=>{
  paths.push(new URL(url).pathname)
  return Response.json(paths.length===1?capabilities:{checkpoint:{nextTurn:1}})
 }})
 const receipt=await adapter.reconcileTurn('same-key')
 assert.equal(receipt.checkpoint.nextTurn,1)
 assert.equal(paths[1],'/internal/luna-certification/reconcile')
})
test('refuses credential-bearing URLs and invalid compare-and-swap responses',async()=>{
 await assert.rejects(createStagingHttpAdapter({...config,baseUrl:'https://user:secret@fixture.invalid/'}),/BASE_URL_INVALID/)
 let count=0
 const {store}=await createStagingHttpAdapter({...config,fetchImpl:async()=>Response.json(++count===1?capabilities:{ok:true})})
 await assert.rejects(store.save(0,{}),/STORE_RESPONSE_INVALID/)
})
