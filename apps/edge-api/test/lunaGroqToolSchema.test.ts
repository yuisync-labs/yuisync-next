import { describe, expect, it } from 'vitest'
import { strictGroqToolSchema, normalizeGroqToolArguments } from '../src/luna/providers/groqToolSchema'
import { createLunaToolRegistry } from '../src/luna/toolRegistry'
import { matchesToolSchema } from '../src/luna/toolSchema'

const example={type:'object',properties:{id:{type:'string'},optional:{type:'object',properties:{name:{type:'string'},note:{type:['string','null']}},required:['name'],additionalProperties:false}},required:['id'],additionalProperties:false}
describe('Groq strict wire schema without weakening domain validation',()=>{
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
  it('uses structural wire constraints but never weakens authoritative domain bounds',()=>{
    const domain={type:'object',properties:{quantity:{type:'integer',minimum:1,maximum:100},name:{type:'string',minLength:1,maxLength:10},items:{type:'array',minItems:1,maxItems:2,items:{type:'string'}},choice:{type:'string',enum:['counter','delivery']}},required:['quantity','name','items'],additionalProperties:false}
    const wire=strictGroqToolSchema(domain) as any
    expect(wire.properties.quantity).toEqual({type:'integer'})
    expect(wire.properties.name).toEqual({type:'string'})
    expect(wire.properties.items).toEqual({type:'array',items:{type:'string'}})
    expect(wire.properties.choice).toEqual({type:['string','null'],enum:['counter','delivery',null]})
    for(const bad of [{quantity:0,name:'valid',items:['one']},{quantity:101,name:'valid',items:['one']},{quantity:1,name:'',items:['one']},{quantity:1,name:'too-long-name',items:['one']},{quantity:1,name:'valid',items:[]},{quantity:1,name:'valid',items:['one','two','three']}]){
      const decoded=JSON.parse(normalizeGroqToolArguments(JSON.stringify({...bad,choice:null}),domain))
      expect(matchesToolSchema(decoded,domain)).toBe(false)
    }
    expect(matchesToolSchema(JSON.parse(normalizeGroqToolArguments('{"quantity":1,"name":"valid","items":["one"],"choice":null}',domain)),domain)).toBe(true)
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
