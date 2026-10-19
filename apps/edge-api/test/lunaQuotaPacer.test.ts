import { describe,it,expect } from 'vitest'
import { createLunaQuotaPacer,resetDurationMs } from '../src/luna/quotaPacer'

describe('Luna quota pacing without retries',()=>{
 it('parses bounded provider reset durations',()=>{
  expect(resetDurationMs('1m2.5s')).toBe(62500)
  expect(resetDurationMs('250ms')).toBe(250)
  expect(resetDurationMs('private data')).toBeNull()
  expect(resetDurationMs(null)).toBeNull()
 })
 it('waits before sending a prompt that exceeds the reported balance plus safety margin',async()=>{
  let now=0;const waits:number[]=[]
  const pacer=createLunaQuotaPacer({now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms}})
  pacer.observe({promptTokens:3074,tokenLimit:8000,remainingTokens:1835,resetTokens:'30s'})
  now=1000
  await pacer.beforeModel()
  expect(waits).toEqual([29250])
  await pacer.beforeModel()
  expect(waits).toHaveLength(1)
 })
 it('does not wait with sufficient balance, and never bypasses unknown/overlong resets',async()=>{
  const waits:number[]=[];const pacer=createLunaQuotaPacer({sleep:async ms=>{waits.push(ms)}})
  pacer.observe({promptTokens:100,tokenLimit:8000,remainingTokens:7000,resetTokens:null})
  await pacer.beforeModel();expect(waits).toEqual([])
  for(const resetTokens of [null,'invalid','2m']){
   pacer.observe({promptTokens:3000,tokenLimit:8000,remainingTokens:1835,resetTokens})
   await expect(pacer.beforeModel()).rejects.toMatchObject({code:'LUNA_RATE_LIMIT_MARGIN'})
  }
 })
 it('bounds total waiting and refuses a prompt too large for the entire bucket',async()=>{
  const pacer=createLunaQuotaPacer({now:()=>0,sleep:async()=>{},maxWaitMs:10000})
  pacer.observe({promptTokens:3000,tokenLimit:8000,remainingTokens:1835,resetTokens:'20s'})
  await expect(pacer.beforeModel()).rejects.toMatchObject({code:'LUNA_RATE_LIMIT_MARGIN'})
  pacer.observe({promptTokens:9000,tokenLimit:8000,remainingTokens:8000,resetTokens:'1s'})
  await expect(pacer.beforeModel()).rejects.toMatchObject({code:'LUNA_RATE_LIMIT_MARGIN'})
 })
})
