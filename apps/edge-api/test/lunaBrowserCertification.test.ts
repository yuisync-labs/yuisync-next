import {describe,it,expect,vi} from 'vitest'
import {lunaNow} from '../src/luna/clock'
import {groqDiagnostic} from '../src/luna/providers/groqDiagnostic'
import {GroqProvider} from '../src/luna/providers/groqProvider'
import {certificationPlayground,certificationInputHint} from '../../../scripts/luna/certificationPlayground'
import {composeLunaModelMessages} from '../src/luna/runLunaTurn'
import {LUNA_DESIGNED_SCENARIOS} from './fixtures/luna/designedScenarios'
import type {LunaExecutionContext} from '../src/luna/contracts'
import {env} from 'cloudflare:workers'
import {hash} from 'bcryptjs'
import {handleBetterAuthRequest} from '../src/auth/betterAuthRuntime'
import worker,{initializeCertificationSchema} from '../../../scripts/luna/stagingWorker'

const context:LunaExecutionContext={tenantId:'fictional',moduleId:'petshop',conversationId:'scenario',customerAddress:'5532999990011',phoneNumberId:'no-whatsapp',sourceMessageId:'test',traceId:'test',executionMode:'staging'}
describe('Human-driven Luna certification',()=>{
 it('keeps legacy-compatible message order and separates tools from final formatting',()=>{
  const history=[{role:'system' as const,content:'Identity and safe operations'},{role:'system' as const,content:'Persisted memory'},{role:'user' as const,content:'Quero uma Ração A.'}]
  const initial=composeLunaModelMessages(history,[])
  expect(initial.filter(m=>m.role==='system')).toHaveLength(1)
  expect(initial.at(-1)).toEqual(history[2])
  expect(initial[0].content).toContain('FASE OPERACIONAL')
  expect(initial[0].content).not.toContain('"blocks"')
  expect(initial[0].content).not.toContain('RESPOSTA FINAL VERIFICADA')
  const tool={role:'tool' as const,tool_call_id:'catalog',content:'{"ok":true}'}
  expect(composeLunaModelMessages([...history,tool],[]).at(-1)).toEqual(tool)
  expect(composeLunaModelMessages(history,[],true)[0].content).toContain('FINALIZAÇÃO SEM FERRAMENTAS')
  expect(composeLunaModelMessages(history,[],true)[0].content).toContain('"blocks"')
  expect(history).toHaveLength(3)
 })
 it('explains exact-script mismatches instead of silently disabling the button',()=>{
  expect(certificationInputHint('Quero uma ração A.','Quero uma Ração A.')).toContain('nada foi enviado')
  expect(certificationInputHint('Quero uma Ração A.','Quero uma Ração A.')).toContain('Você pode enviar')
  expect(certificationInputHint('','test')).toContain('maiúsculas')
 })
 it('identifies generation shape without retaining generated data or private reasoning',()=>{
  const result=groqDiagnostic({code:'tool_use_failed',failed_generation:'{"blocks":[{"kind":"social","text":"private@example.com gsk_secret"}]}',message:'Failed to call a function'},400,[])
  expect(result.failedGenerationShape).toBe('final_json')
  expect(JSON.stringify(result)).not.toMatch(/private@example|gsk_secret|social/)
  expect(groqDiagnostic({failed_generation:'<tool_call>secret</tool_call>'},400,[]).failedGenerationShape).toBe('tool_markup')
 })
 it('requires a real staging session and designated global admin, meters its auth reads and resumes without calling Groq',async()=>{
  const DB=(env as EdgeEnv & {DB:D1Database}).DB,AUTH_DB=(env as EdgeEnv & {AUTH_DB:D1Database}).AUTH_DB
  const id=crypto.randomUUID(),email=id+'@test.invalid',password='FixtureOnlyPassword123!',now=new Date().toISOString()
  await AUTH_DB.batch([
   AUTH_DB.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?1,?1,?2,1,?3,?3)').bind(id,email,now),
   AUTH_DB.prepare("INSERT INTO account(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?1,?1,?1,'credential',?2,?3,?3)").bind(id,await hash(password,12),now),
  ])
  await DB.batch([
   DB.prepare("INSERT INTO identity_principals VALUES(?1,'better-auth',?1,'Fixture operator',?2,'active',1,1)").bind(id,email),
   DB.prepare("INSERT INTO platform_administrators VALUES(?1,'active',1,1)").bind(id),
  ])
  await initializeCertificationSchema(DB)
  await DB.prepare("INSERT INTO luna_cert_identity VALUES(1,'local-browser-fixture','isolated-luna-v2')").run()
  const fixtureDB={prepare:(sql:string)=>DB.prepare(sql),batch:(s:D1PreparedStatement[])=>DB.batch(s)} as D1Database
  const bindings={...env,DB,AUTH_DB,LUNA_CERT_DB:fixtureDB,APP_ENV:'staging',EDGE_BETTER_AUTH_ENABLED:'true',BETTER_AUTH_SECRET:'fixture-only-long-test-secret-12345678901234567890123',LUNA_ENABLED:'false',LUNA_CERT_ENV:'isolated-luna-v2',LUNA_CERT_TOKEN:'fixture-token',LUNA_CERT_DATABASE_ID:'local-browser-fixture',RELEASE_SHA:'browser-fixture-sha',LUNA_CERT_GATES_SHA:'browser-fixture-sha',LUNA_CERT_OPERATOR_ID:id} as any
  const signIn=await handleBetterAuthRequest(new Request('https://fixture.invalid/api/auth/sign-in/email',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({email,password})}),bindings)
  expect(signIn?.status).toBe(200)
  const cookie=signIn!.headers.get('set-cookie')!.split(';')[0]
  const request=(origin='https://fixture.invalid',session=cookie)=>new Request('https://fixture.invalid/api/ai-lab/luna/certification/browser-state',{method:'POST',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify({roundId:'groq-ui-browser-fixt'})})
  expect((await worker.fetch(request('https://attacker.invalid'),bindings,{} as ExecutionContext)).status).toBe(401)
  expect((await worker.fetch(request(undefined,''),bindings,{} as ExecutionContext)).status).toBe(401)
  const response=await worker.fetch(request(),bindings,{} as ExecutionContext),state=await response.json() as any
  expect(response.status).toBe(200)
  expect(state.next).toEqual({scenarioId:1,turn:0})
  expect(state.budget.calls).toBe(0)
  expect(state.budget.admin_reads).toBeGreaterThan(0)
  const denied=await worker.fetch(request(),{...bindings,LUNA_CERT_OPERATOR_ID:'different-user'},{} as ExecutionContext)
  expect(denied.status).toBe(403)
 })
 it('injects a trusted clock without mutating globals and cannot override production',()=>{
  expect(lunaNow({...context,nowMs:123})).toBe(123)
  expect(lunaNow({...context,executionMode:'production',nowMs:123})).toBeGreaterThan(123)
  expect(()=>lunaNow({...context,nowMs:NaN})).toThrow('CLOCK_INVALID')
 })
 it('extracts only finite provider diagnostics, never raw message or reasoning',()=>{
  const error={type:'invalid_request_error',message:'strict is not supported in tool schema. customer private@example.com',failed_generation:'private reasoning and gsk_secret get_customer_context'}
  const result=groqDiagnostic(error,400,['get_customer_context'])
  expect(result.reasons).toEqual(['unsupported_parameter','invalid_schema'])
  expect(result.controls).toEqual(['strict'])
  expect(result.generatedToolNames).toEqual(['get_customer_context'])
  expect(JSON.stringify(result)).not.toMatch(/private|gsk_secret|reasoning/)
 })
 it('reserves the transformed request actually sent to Groq including grammar expansion',async()=>{
  const fetchFn=vi.fn(async(_url:Parameters<typeof fetch>[0],_init?:Parameters<typeof fetch>[1])=>Response.json({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:10,completion_tokens:5}}))
  const provider=new GroqProvider({apiKey:'fake',model:'openai/gpt-oss-20b',fetchFn})
  const input={messages:[{role:'user' as const,content:'fixture'}],tools:[{name:'tool',description:'test',parameters:{type:'object',properties:{optional:{type:'string'}}}}]}
  const serialized=provider.serializeRequest(input)
  expect(provider.reservationTokens(input)).toBe(new TextEncoder().encode(serialized).length+5296)
  await provider.complete(input)
  expect(fetchFn.mock.calls[0]?.[1]?.body).toBe(serialized)
 })
 it('renders all canonical scenarios but has no auto-send, key, provider bypass or legacy fallback',async()=>{
  const response=certificationPlayground('abc123'),html=await response.text()
  for(const scenario of LUNA_DESIGNED_SCENARIOS)expect(html).toContain(JSON.stringify(scenario.messages[0]).slice(1,-1))
  expect(html).toContain('addEventListener(\'click\'')
  expect(html).not.toMatch(/api\.groq\.com|legacy-preview|localStorage|setInterval|apiKey/)
  expect(html).not.toContain('[Sem resposta conclusiva]')
  expect(html).toContain('Diagnóstico de execução (não é uma resposta da Luna)')
  expect(html).toContain('aria-describedby="input-hint"')
  expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'")
  expect(response.headers.get('cache-control')).toBe('no-store')
 })
})
