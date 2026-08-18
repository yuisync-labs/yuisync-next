import fs from 'node:fs'

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${label}: target not found in ${path}`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target is not unique in ${path}`)
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

const runtime = 'apps/edge-api/src/compatApiRuntime.js'

replaceOnce(
  runtime,
  "for (const key of ['details','bot_metadata','service_items','subscription_benefits','services','services_used','tags','metadata','parsed_intent','raw_response'])",
  "for (const key of ['details','bot_metadata','service_items','subscription_benefits','services','services_used','tags','metadata','context','parsed_intent','raw_response'])",
  'normalize chat context json',
)

replaceOnce(
  runtime,
  "function paymentMethod(value) { const v=String(value ?? '').toLowerCase(); if (v.includes('pix')) return 'pix'; if (v.includes('dinheiro')||v==='cash') return 'cash'; return 'card' }\n",
  `function paymentMethod(value) { const v=String(value ?? '').toLowerCase(); if (v.includes('pix')) return 'pix'; if (v.includes('dinheiro')||v==='cash') return 'cash'; return 'card' }\n\nexport function normalizeCompatChatSession(raw, scope, id = str(raw?.id) || crypto.randomUUID(), now = Date.now()) {\n  const statusValue=str(raw?.status).toLowerCase()\n  const status=['human','handoff'].includes(statusValue)?'handoff':statusValue==='closed'?'closed':'open'\n  const legacyChannel=str(raw?.channel).toLowerCase()\n  const channel=legacyChannel==='website'||legacyChannel==='web'||legacyChannel==='instagram'?'web':legacyChannel==='interno'||legacyChannel==='internal'?'internal':'whatsapp'\n  const context={...obj(raw?.context)}\n  if(legacyChannel==='instagram')context.legacy_channel='instagram'\n  else if('legacy_channel'in context)delete context.legacy_channel\n  const csat=raw?.csat_score==null?null:Math.max(1,Math.min(5,Math.round(num(raw.csat_score))))\n  return {\n    tenant_id:scope.tenantId,module_id:scope.moduleId,id,channel,\n    external_thread_id:str(raw?.customer_phone??raw?.phone??raw?.external_thread_id),\n    client_id:str(raw?.client_id),pet_id:str(raw?.pet_id),customer_name:str(raw?.customer_name),\n    status,intent:str(raw?.intent),assigned_staff_key:str(raw?.employee_id??raw?.assigned_staff_key),\n    csat_score:csat,closed_at_ms:nullableEpoch(raw?.closed_at),context_json:jsonString(context,{}),\n    last_message_at_ms:nullableEpoch(raw?.last_message_at),created_at_ms:epoch(raw?.opened_at??raw?.created_at,now),updated_at_ms:now,\n  }\n}\n`,
  'chat session canonical helper',
)

const oldChatSession = "  if(table==='chat_sessions')return{...base,id,channel:str(raw.channel)||'whatsapp',external_thread_id:str(raw.phone??raw.external_thread_id),client_id:str(raw.client_id),pet_id:str(raw.pet_id),status:raw.status==='human'?'handoff':str(raw.status)||'open',last_message_at_ms:nullableEpoch(raw.last_message_at),created_at_ms:epoch(raw.created_at,now),updated_at_ms:now}"
replaceOnce(
  runtime,
  oldChatSession,
  "  if(table==='chat_sessions')return normalizeCompatChatSession(raw,scope,id,now)",
  'chat session canonical mapping',
)

const oldChatMessage = "  if(table==='chat_messages'){const role=str(raw.role)||'system',actor=role==='user'?'customer':role==='human_agent'?'human':role==='assistant'?'assistant':'system';return{...base,id,thread_id:str(raw.session_id??raw.thread_id),external_message_id:str(raw.external_message_id),direction:actor==='customer'?'inbound':'outbound',actor_type:actor,content_text:str(raw.content)||'',content_json:raw.content_json==null?null:jsonString(raw.content_json,{}),created_at_ms:epoch(raw.created_at,now)}}"
replaceOnce(
  runtime,
  oldChatMessage,
  "  if(table==='chat_messages'){const role=str(raw.role)||'system',actor=role==='user'?'customer':role==='human_agent'?'human':role==='assistant'?'assistant':'system',metadata=raw.content_json??raw.metadata;return{...base,id,thread_id:str(raw.session_id??raw.thread_id),external_message_id:str(raw.external_message_id),direction:actor==='customer'?'inbound':'outbound',actor_type:actor,content_text:str(raw.content)||'',content_json:metadata==null?null:jsonString(metadata,{}),created_at_ms:epoch(raw.sent_at??raw.created_at,now)}}",
  'chat message metadata mapping',
)

replaceOnce(
  runtime,
  "  }catch(error){const code=error instanceof Error?error.message:'COMPAT_QUERY_FAILED';if(['SCOPE_MISMATCH','INVALID_FILTER','INVALID_ORDER','WRITE_REQUIRES_ID','WRITE_NOT_SUPPORTED','APPOINTMENT_PARTY_REQUIRED','SERVICE_REQUIRED'].includes(code))return json({code},400);console.error('compat.query.failed',{table,action,code});return json({code:'COMPAT_QUERY_FAILED'},500)}",
  "  }catch(error){const code=error instanceof Error?error.message:'COMPAT_QUERY_FAILED';if(code==='STOCK_MUTATION_REQUIRES_INVENTORY_COMMAND')return json({code},409);if(code.includes('CASH_REGISTER_ALREADY_OPEN'))return json({code:'CASH_REGISTER_ALREADY_OPEN'},409);if(['SCOPE_MISMATCH','INVALID_FILTER','INVALID_ORDER','WRITE_REQUIRES_ID','WRITE_NOT_SUPPORTED','APPOINTMENT_PARTY_REQUIRED','SERVICE_REQUIRED'].includes(code))return json({code},400);console.error('compat.query.failed',{table,action,code});return json({code:'COMPAT_QUERY_FAILED'},500)}",
  'compat conflict status mapping',
)

console.log('PR64 chat compatibility codemod applied.')
