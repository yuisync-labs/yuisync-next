// Test-only Worker: never imported by the application or local homologation config.
export {default} from '../src/index'
export * from '../src/index'
export {LunaNativeAgent} from '../src/luna/nativeCloudflareAgent'
import {LunaThinkAgent} from '../src/luna/thinkAgent'
import {action} from '@cloudflare/think'
import {MockLanguageModelV3} from 'ai/test'
import type {LanguageModel} from 'ai'
import type {ThinkStep} from './fixtures/luna/thinkHarness'

export class ThinkRecoveryTestAgent extends LunaThinkAgent{
 async setScript(script:ThinkStep[],abortAfterCommit=false){await this.ctx.storage.put({'test:script':script,'test:abort':abortAfterCommit,'test:index':0})}
 getModel():LanguageModel{
  return new MockLanguageModelV3({doStream:async()=>{
   const script=await this.ctx.storage.get<ThinkStep[]>('test:script');if(!script?.length)throw Error('TEST_SCRIPT_MISSING')
   const index=await this.ctx.storage.get<number>('test:index')??0,next=script[Math.min(index,script.length-1)]
   await this.ctx.storage.put('test:index',index+1)
   return {stream:new ReadableStream({start(c){c.enqueue({type:'stream-start',warnings:[]});if(typeof next==='string'){c.enqueue({type:'text-start',id:'text'});c.enqueue({type:'text-delta',id:'text',delta:next});c.enqueue({type:'text-end',id:'text'})}else c.enqueue({type:'tool-call',toolCallId:crypto.randomUUID(),toolName:next.name,input:JSON.stringify(next.input)});c.enqueue({type:'finish',finishReason:{unified:typeof next==='string'?'stop':'tool-calls',raw:'fixture'},usage:{inputTokens:{total:50,noCache:50,cacheRead:0,cacheWrite:0},outputTokens:{total:20,text:20,reasoning:0}}});c.close()}})}
  }})
 }
 getActions(){
  const actions=super.getActions(),original=actions.commit_confirmed_proposal.config
  actions.commit_confirmed_proposal=action({...original,execute:async(input,ctx)=>{
   const result=await original.execute(input,ctx)
   if(await this.ctx.storage.get<boolean>('test:abort')){
    await this.ctx.storage.put('test:abort',false)
    await this.ctx.storage.sync()
    this.ctx.abort('TEST_CRASH_AFTER_DOMAIN_COMMIT')
   }
   return result
  }})
  return actions
 }
}
