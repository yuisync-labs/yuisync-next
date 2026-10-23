// Test-only Worker: never imported by the application or local homologation config.
export {default} from '../src/index'
export * from '../src/index'
export {LunaNativeAgent} from '../src/luna/nativeCloudflareAgent'
export {LunaNativeAgent as PreservedLunaNativeAgent} from '../src/luna/preservedNativeAgent'
import {LunaThinkAgent as AppLunaThinkAgent} from '../src/luna/thinkAgent'
import {createWorkersAI} from 'workers-ai-provider'
import {THINK_MODEL} from '../src/luna/thinkPolicy'
import {action} from '@cloudflare/think'
import {MockLanguageModelV3} from 'ai/test'
import type {LanguageModel} from 'ai'
import type {ThinkStep} from './fixtures/luna/thinkHarness'

// A method monkeypatch in runInDurableObject is not a durable provider binding:
// a cold native submission may reconstruct the agent after the debounce window.
// Keep the bridge in this test-only class, including after reconstruction.
export class LunaThinkAgent extends AppLunaThinkAgent{
 getModel():LanguageModel{
  const live=(this.env as EdgeEnv&{LIVE_MODEL?:Fetcher}).LIVE_MODEL
  if(!live)return super.getModel()
  return createWorkersAI({binding:{run:async(model:string,input:unknown)=>{
   const response=await live.fetch('https://live-model.local/run',{method:'POST',body:JSON.stringify({model,input})})
   if(!response.ok)throw Error('LIVE_MODEL_ERROR_'+response.status+':'+await response.text())
   return response.json()
  }} as never})(THINK_MODEL,{chat_template_kwargs:{enable_thinking:false}})
 }
 async beforeTurn(ctx:Parameters<AppLunaThinkAgent['beforeTurn']>[0]){
  const config=await super.beforeTurn(ctx)
  return (this.env as EdgeEnv&{LIVE_MODEL?:Fetcher}).LIVE_MODEL?{...config,timeout:600000}:config
 }
}

export class ThinkRecoveryTestAgent extends AppLunaThinkAgent{
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
