export function billingModuleAllowed(role:string,raw:string|null,moduleId:string){
 if(role==='owner'||role==='admin')return true
 try{const p=JSON.parse(raw||'{}') as Record<string,unknown>;const v=p[moduleId]??p['*'];return v===true||typeof v==='string'||Boolean(v&&typeof v==='object')}catch{return false}
}
