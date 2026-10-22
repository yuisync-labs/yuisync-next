import { describe, expect, it } from 'vitest'
import { strictGroqToolSchema, normalizeGroqToolArguments, groqWireToolSchema, groqWireToolArguments, normalizeGroqWireArguments } from '../src/luna/providers/groqToolSchema'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { matchesToolSchema } from '../src/luna/toolSchema'

const example={type:'object',properties:{id:{type:'string'},optional:{type:'object',properties:{name:{type:'string'},note:{type:['string','null']}},required:['name'],additionalProperties:false}},required:['id'],additionalProperties:false}
describe('Groq strict wire schema without weakening domain validation',()=>{
  it('exposes one parameter convention and reverses nested draft events without changing reducer contracts',()=>{
    const tool=createLunaToolRegistry({} as D1Database).definitions.find(tool=>tool.name==='record_turn_decision')!
    const original=JSON.stringify(tool.parameters),wire=groqWireToolSchema(tool.parameters) as any
    expect(wire.properties.events.items.required).toContain('operation_id')
    expect(wire.properties.events.items.required).toContain('expected_version')
    expect(wire.properties.events.items.properties).not.toHaveProperty('operationId')
    const args={intents:[{operation_id:'cart',kind:'cart',goal:'create'}],focus:'cart',events:[{operationId:'cart',kind:'cart',expectedVersion:0,action:'add_item',itemId:'product',quantity:1}]}
    const serialized=groqWireToolArguments(JSON.stringify(args),tool.parameters)
    expect(JSON.parse(serialized).events[0]).toMatchObject({operation_id:'cart',expected_version:0,item_id:'product'})
    expect(matchesToolSchema(JSON.parse(serialized),wire)).toBe(true)
    const decoded=JSON.parse(normalizeGroqWireArguments(serialized,tool.parameters))
    expect(decoded).toEqual(args)
    expect(matchesToolSchema(decoded,tool.parameters)).toBe(true)
    expect(JSON.stringify(tool.parameters)).toBe(original)
  })
  it('preserves business strings and refuses alias collisions or foreign arguments',()=>{
    const schema=createLunaToolRegistry({} as D1Database).definitions.find(tool=>tool.name==='update_operation_draft')!.parameters
    const raw=JSON.stringify({operation_id:'cart',kind:'cart',expected_version:0,action:'set_field',field:'address',value:'operationId, expectedVersion, itemId',tenant_id:'foreign'})
    const decoded=JSON.parse(normalizeGroqWireArguments(raw,schema))
    expect(decoded.value).toBe('operationId, expectedVersion, itemId')
    expect(decoded.tenant_id).toBe('foreign')
    expect(matchesToolSchema(decoded,schema)).toBe(false)
    const collision=JSON.stringify({operationId:'one',operation_id:'two',kind:'cart',expected_version:0,action:'pause'})
    expect(matchesToolSchema(JSON.parse(normalizeGroqWireArguments(collision,schema)),schema)).toBe(false)
  })
  it('requires closed wire objects recursively and preserves the original schema',()=>{
    const before=JSON.stringify(example),wire=strictGroqToolSchema(example) as any
    expect(wire.required).toEqual(['id','optional'])
    expect(wire.properties.optional.type).toEqual(['object','null'])
    expect(wire.properties.optional.required).toEqual(['name','note'])
    expect(wire.properties.optional.additionalProperties).toBe(false)
    expect(JSON.stringify(example)).toBe(before)
    expect(JSON.parse(normalizeGroqToolArguments('{"id":"known","optional":null}',example))).toEqual({id:'known'})
    expect(JSON.parse(normalizeGroqToolArguments('{"id":"known","optional":{"name":"pet","note":null}}',example))).toEqual({id:'known',optional:{name:'pet',note:null}})
  })
  it('preserves wire and authoritative domain bounds',()=>{
    const domain={type:'object',properties:{quantity:{type:'integer',minimum:1,maximum:100},name:{type:'string',minLength:1,maxLength:10},items:{type:'array',minItems:1,maxItems:2,items:{type:'string'}},choice:{type:'string',enum:['counter','delivery']}},required:['quantity','name','items'],additionalProperties:false}
    const wire=strictGroqToolSchema(domain) as any
    expect(wire.properties.quantity).toEqual(domain.properties.quantity)
    expect(wire.properties.name).toEqual(domain.properties.name)
    expect(wire.properties.items).toEqual(domain.properties.items)
    expect(wire.properties.choice).toEqual({type:['string','null'],enum:['counter','delivery',null]})
    for(const bad of [{quantity:0,name:'valid',items:['one']},{quantity:101,name:'valid',items:['one']},{quantity:1,name:'',items:['one']},{quantity:1,name:'too-long-name',items:['one']},{quantity:1,name:'valid',items:[]},{quantity:1,name:'valid',items:['one','two','three']}]){
      const decoded=JSON.parse(normalizeGroqToolArguments(JSON.stringify({...bad,choice:null}),domain))
      expect(matchesToolSchema(decoded,domain)).toBe(false)
    }
    expect(matchesToolSchema(JSON.parse(normalizeGroqToolArguments('{"quantity":1,"name":"valid","items":["one"],"choice":null}',domain)),domain)).toBe(true)
  })
  it('represents no-argument functions with an inert wire sentinel, without hiding invalid arguments',()=>{
    const domain={type:'object',properties:{},required:[],additionalProperties:false}
    expect(strictGroqToolSchema(domain)).toEqual({type:'object',properties:{_no_arguments:{type:'string',enum:['none']}},required:['_no_arguments'],additionalProperties:false})
    expect(JSON.parse(normalizeGroqToolArguments('{"_no_arguments":"none"}',domain))).toEqual({})
    for(const raw of ['{"_no_arguments":"write"}','{"_no_arguments":null}','{"_no_arguments":"none","tenant_id":"foreign"}']) expect(matchesToolSchema(JSON.parse(normalizeGroqToolArguments(raw,domain)),domain)).toBe(false)
    expect(domain.properties).toEqual({})
  })
  it('does not conceal unknown arguments, required nulls or malformed JSON',()=>{
    const invalid=JSON.parse(normalizeGroqToolArguments('{"id":null,"tenant_id":"foreign","optional":null}',example))
    expect(invalid).toEqual({id:null,tenant_id:'foreign'})
    expect(matchesToolSchema(invalid,example)).toBe(false)
    expect(normalizeGroqToolArguments('not JSON',example)).toBe('not JSON')
  })
  it('makes every native tool schema strict-compatible without altering its domain contract',()=>{
    const definitions=createLunaToolRegistry({} as D1Database).definitions
    function validate(schema:any){
      if(schema.properties){expect(schema.required).toEqual(Object.keys(schema.properties));expect(schema.additionalProperties).toBe(false);Object.values(schema.properties).forEach(validate)}
      if(schema.items)validate(schema.items)
      if(schema.anyOf)schema.anyOf.forEach(validate)
    }
    for(const tool of definitions){const before=JSON.stringify(tool.parameters);validate(strictGroqToolSchema(tool.parameters));expect(JSON.stringify(tool.parameters)).toBe(before)}
  })
})
