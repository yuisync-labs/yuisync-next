import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForStagingRelease } from '../../scripts/luna/stagingRelease.mjs'
const base='https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev/'
const sha='a'.repeat(40)
test('release verification accepts only the exact staging SHA after bounded visibility lag',async()=>{
 let calls=0,waits=0
 const result=await waitForStagingRelease(base,sha,{pause:async()=>{waits++},fetchFn:async(url,options)=>{
  assert.equal(url.href,base+'release');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store')
  return Response.json({environment:'staging',release_sha:++calls===1?'b'.repeat(40):sha})
 }})
 assert.equal(result.release_sha,sha);assert.equal(calls,2);assert.equal(waits,1)
})
test('a permanently stale or unavailable release fails, never becomes a passing gate',async()=>{
 for(const failedNetwork of [false,true]){
  let calls=0,waits=0
  await assert.rejects(waitForStagingRelease(base,sha,{pause:async()=>{waits++},fetchFn:async()=>{
   calls++;if(failedNetwork)throw Error('network');return Response.json({environment:'staging',release_sha:null})
  }}),/CERTIFICATION_RELEASE_SHA_MISMATCH/)
  assert.equal(calls,6);assert.equal(waits,5)
 }
})
test('production and invalid targets cannot be accepted or queried',async()=>{
 let calls=0
 const fetchFn=async()=>{calls++;return Response.json({environment:'production',release_sha:sha})}
 await assert.rejects(waitForStagingRelease('https://yuisync.app/',sha,{fetchFn}),/TARGET_INVALID/)
 assert.equal(calls,0)
 await assert.rejects(waitForStagingRelease(base,sha,{fetchFn}),/ENVIRONMENT_MISMATCH/)
 assert.equal(calls,1)
})
