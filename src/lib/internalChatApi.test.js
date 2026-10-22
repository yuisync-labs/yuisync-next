import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestChatReply, getChatTurnStatus } from './api'

afterEach(()=>vi.unstubAllGlobals())
const options={tenantId:'fixture-tenant',moduleId:'petshop',clientMessageId:'stable-source'}
describe('Internal chat 202 transport',()=>{
 it('submits once and reads the scoped durable result without replaying inference',async()=>{
  const id='a'.repeat(64),onStatus=vi.fn()
  const fetchMock=vi.fn()
   .mockResolvedValueOnce(Response.json({accepted:true,turn_id:id,status:'queued'},{status:202}))
   .mockResolvedValueOnce(Response.json({id,status:'complete',result:{reply:'Verificado',savedUserMessages:[{id:'stable-source'}]}}))
  vi.stubGlobal('fetch',fetchMock)
  expect(await requestChatReply('fixture-chat','Olá',{...options,onStatus})).toMatchObject({reply:'Verificado'})
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).clientMessageId).toBe('stable-source')
  expect(fetchMock.mock.calls[1][0]).toContain(`/chat/turns/${id}?sessionId=fixture-chat`)
  expect(fetchMock.mock.calls[1][1]).toMatchObject({method:'GET',headers:{'x-tenant-id':'fixture-tenant','x-module-id':'petshop'}})
  expect(onStatus.mock.calls.map(([job])=>job.status)).toEqual(['queued','complete'])
 })
 it('keeps ambiguous turns blocked rather than issuing another submission',async()=>{
  const fetchMock=vi.fn()
   .mockResolvedValueOnce(Response.json({accepted:true,turn_id:'a'.repeat(64),status:'queued'},{status:202}))
   .mockResolvedValueOnce(Response.json({status:'requires_reconciliation',errorCode:'UNKNOWN_EXTERNAL_RESULT'}))
  vi.stubGlobal('fetch',fetchMock)
  await expect(requestChatReply('fixture-chat','Olá',options)).rejects.toThrow('não reenvie')
  expect(fetchMock.mock.calls.filter(([,input])=>input.method==='POST')).toHaveLength(1)
 })
 it('recovers latest state using a read only, after a browser reload',async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({id:'a'.repeat(64),status:'waiting_quota'}))
  vi.stubGlobal('fetch',fetchMock)
  expect(await getChatTurnStatus('fixture-chat','latest',options)).toMatchObject({status:'waiting_quota'})
  expect(fetchMock.mock.calls[0][1].method).toBe('GET')
 })
})
