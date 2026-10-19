import {env} from 'cloudflare:workers'
import {it,expect} from 'vitest'
import {selectRows} from '../src/compatApiRuntime.js'

it('keeps multiple conversations and messages when the compatibility client sends limit:null',async()=>{
 const db=env.DB!,tenant='think-chat-default-limit',now=Date.now()
 await db.prepare("INSERT INTO tenants(id,slug,name,status,created_at_ms,updated_at_ms) VALUES(?,?,'Fixture','active',?,?)").bind(tenant,tenant,now,now).run()
 await db.batch(Array.from({length:3},(_,index)=>db.prepare("INSERT INTO chat_threads(tenant_id,module_id,id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'internal',?,'open',?,?)").bind(tenant,'thread-'+index,'553299990000'+index,now,now)))
 await db.batch(Array.from({length:3},(_,index)=>db.prepare("INSERT INTO chat_messages(tenant_id,module_id,id,thread_id,direction,actor_type,content_text,created_at_ms) VALUES(?,'petshop',?,'thread-0','inbound','customer',?,?)").bind(tenant,'msg-'+index,'Mensagem '+index,now+index)))
 const scope={tenantId:tenant,moduleId:'petshop'}
 const base={filters:[],orders:[],range:null,limit:null}
 expect((await selectRows(db,'chat_sessions',{read:'compat_chat_sessions'},base,scope)).rows).toHaveLength(3)
 expect((await selectRows(db,'chat_messages',{read:'compat_chat_messages'},base,scope)).rows).toHaveLength(3)
 expect((await selectRows(db,'chat_messages',{read:'compat_chat_messages'},{...base,limit:1},scope)).rows).toHaveLength(1)
 expect((await selectRows(db,'chat_messages',{read:'compat_chat_messages'},{...base,range:{from:1,to:2}},scope)).rows).toHaveLength(2)
 await db.batch(Array.from({length:110},(_,index)=>[
  db.prepare("INSERT INTO clients(tenant_id,module_id,id,name,phone,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,'Fixture',?,'active',?,?)").bind(tenant,'customer-'+index,'5532999910'+index,now,now),
  db.prepare("INSERT INTO chat_threads(tenant_id,module_id,id,client_id,channel,external_thread_id,status,created_at_ms,updated_at_ms) VALUES(?,'petshop',?,?,'internal',?,'open',?,?)").bind(tenant,'enriched-'+index,'customer-'+index,'5532999910'+index,now,now),
 ]).flat())
 const complete=await selectRows(db,'chat_sessions',{read:'compat_chat_sessions'},{...base,columns:'*,clients(name,details)'},scope)
 expect(complete.rows).toHaveLength(113)
 expect(complete.rows.filter((row:{clients?:unknown})=>row.clients)).toHaveLength(110)
})
