export const CERTIFICATION_BLOCK_LIMITS={calls:120,tokens:250000,rowsRead:100000} as const
export function certificationBlock(sha:string,roundId:string,provider='groq'){
 if(!['groq','workers-ai'].includes(provider))return null
 if(roundId===`${provider}-ui-${sha.slice(0,12)}-sample`)return {block:0,first:1,last:13,scenarioIds:[1,6,11,13],sample:true as const}
 const prefix=`${provider}-ui-${sha.slice(0,12)}-b`
 if(!roundId.startsWith(prefix))return null
 const block=Number(roundId.slice(prefix.length))
 if(!Number.isInteger(block)||block<1||block>5||roundId!==prefix+block)return null
 return {block,first:(block-1)*4+1,last:block*4}
}
