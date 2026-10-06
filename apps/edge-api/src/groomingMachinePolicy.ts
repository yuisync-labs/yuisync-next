// Operational catalogue classification, matching the native grooming UI.
// This is not a classifier for customer phrases.
export function requiresGroomingMachine(services:readonly {code?:unknown;name?:unknown}[]):boolean {
  const text=services.flatMap(s=>[s.code,s.name]).filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ')
  return /\bmaquina\b|\bmachine\s+grooming\b/.test(text)
}
export function validateGroomingMachine(services:readonly {code?:unknown;name?:unknown}[],value:unknown):{ok:true;number:number|null}|{ok:false;code:string} {
  const needed=requiresGroomingMachine(services)
  if(!needed)return value==null?{ok:true,number:null}:{ok:false,code:'GROOMING_MACHINE_NOT_APPLICABLE'}
  if(value==null)return{ok:false,code:'GROOMING_MACHINE_REQUIRED'}
  return Number.isInteger(value)&&[4,7,10].includes(Number(value))?{ok:true,number:Number(value)}:{ok:false,code:'INVALID_GROOMING_MACHINE_NUMBER'}
}
