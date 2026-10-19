import {describe,it} from 'vitest'
import {pathNames,runThinkPath} from './fixtures/luna/thinkPaths'
describe('TXT adaptado 21–30: Think/Actions/Sessions e D1 reais, LLM simulada',()=>{
 for(let id=21;id<=30;id++)it(String(id).padStart(2,'0')+' '+pathNames[id-1],()=>runThinkPath(id),30000)
})
