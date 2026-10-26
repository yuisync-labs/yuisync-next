import { z } from 'zod';
import {classificationFields,profileJoin,profileColumns,foodSaleForm,addClassificationFilters,chooseRefinement,type Refinement} from './classification';
export const preferencesSchema=z.object({
 ...classificationFields,
 productType:z.enum(['feed','treat']).nullable().optional(),
 species:z.enum(['dog','cat','bird','rabbit','rodent','fish']).nullable().optional(),
 lifeStage:z.enum(['puppy','adult','senior']).nullable().optional(),
 saleForm:z.enum(['bulk','packaged']).nullable().optional(),
 packageWeightGrams:z.number().int().min(1).max(100000).nullable().optional(),
 anyWeight:z.boolean().optional(),brand:z.string().trim().min(1).max(80).nullable().optional().describe('Marca informada pelo cliente ou já escolhida na conversa. Nunca escolha uma marca usando as opções de refinement sem ouvir o cliente.'),
 animalSize:z.enum(['small','medium','large','giant']).nullable().optional(),
 catalogCategory:z.enum(['accessory','hygiene','toy','medicine','aquarium','garden','beverage','other','treat']).nullable().optional().describe('hygiene=higiene (areia sanitária de gato, tapete, shampoo); accessory=acessórios; toy=brinquedos; medicine=medicamentos; aquarium=aquarismo de peixes; garden=jardinagem; beverage=bebidas; treat=petiscos.'),
 maxPriceCents:z.number().int().min(1).max(10000000).nullable().optional(),
 nameTerms:z.array(z.string().trim().min(1).max(40)).max(6).nullable().optional(),
 productLine:z.string().trim().min(1).max(80).nullable().optional().describe('Linha específica, como Supreme ou Life; não é a marca.'),
 productName:z.string().trim().min(1).max(100).nullable().optional().describe('Nome específico, como osso palito. Não incluir espécie, peso, fase nem palavras do pedido.')
}).strict();
export const updateSchema=preferencesSchema.extend({
 action:z.enum(['search','details','availability','bulk_total','reply']).default('search').describe('search para catálogo, details para opção já mostrada, availability para estoque/reserva, bulk_total para total a granel, reply somente cumprimento/nome/conversa sem afirmação comercial.'),
 remove:z.array(preferencesSchema.keyof()).max(30).optional().describe('Filtros que o cliente autorizou remover. Remover somente estes; omitir mantém os demais.'),
 reset:z.boolean().optional(),evidence:z.string().min(1).max(2000).describe('Trecho literal da última mensagem do cliente que justifica estas alterações.')});
export type Preferences=z.infer<typeof preferencesSchema>;
export type Memory={preferences:Preferences;evidence:Record<string,{quote:string;messageId:string}>;lastProductIds:string[];lastOutOfStockProductIds?:string[];unrestricted?:(keyof Preferences)[];refinement?:Refinement};
export function newPreferenceChanges(before:Preferences,changes:Record<string,unknown>,reset=false){
 if(reset)return changes;
 const comparable=(v:unknown)=>typeof v==='string'?v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim():JSON.stringify(v);
 return Object.fromEntries(Object.entries(changes).filter(([key,value])=>comparable(value)!==comparable(before[key as keyof Preferences])));
}
export function applyPreferences(memory:Memory,input:unknown,userText:string,messageId:string):Memory{
 const {evidence,reset,remove=[],action,...changes}=updateSchema.parse(input);
 for(const key of remove){if(changes[key]!=null)throw new Error('CONFLICTING_FILTER_OPERATION');}
 if(!userText.includes(evidence))throw new Error('EVIDENCE_NOT_IN_USER_MESSAGE');
 const speciesChanged=changes.species!=null&&memory.preferences.species!=null&&changes.species!==memory.preferences.species;
 const typeChanged=(changes.productType!=null&&(memory.preferences.catalogCategory!=null||memory.preferences.productType!=null&&changes.productType!==memory.preferences.productType))||(changes.catalogCategory!=null&&changes.catalogCategory!==memory.preferences.catalogCategory)||(changes.subtype!=null&&memory.preferences.subtype!=null&&changes.subtype!==memory.preferences.subtype);
 const subtypeChanged=changes.subtype!=null&&memory.preferences.subtype!=null&&changes.subtype!==memory.preferences.subtype;
 let preferences:Preferences=reset||typeChanged?{}:subtypeChanged?{catalogCategory:memory.preferences.catalogCategory,productType:memory.preferences.productType,species:memory.preferences.species}:speciesChanged?{productType:memory.preferences.productType,catalogCategory:memory.preferences.catalogCategory,subtype:memory.preferences.subtype}:{...memory.preferences};
 preferences=Object.fromEntries(Object.entries(preferences).filter(([,v])=>v!==undefined));
 const sources=reset||speciesChanged||typeChanged||subtypeChanged?{}:{...memory.evidence};
 const unrestricted=new Set<keyof Preferences>(reset||speciesChanged||typeChanged||subtypeChanged?[]:memory.unrestricted??[]);
 for(const key of remove){delete preferences[key];delete sources[key];unrestricted.add(key);}
 for(const key of Object.keys(changes) as (keyof Preferences)[]){
  const value=changes[key];if(value===undefined)continue;
  if(value===null){delete preferences[key];delete sources[key];unrestricted.add(key);}
  else{preferences={...preferences,[key]:value};sources[key]={quote:evidence,messageId};unrestricted.delete(key);}
 }
 if(preferences.saleForm==='bulk'){delete preferences.packageWeightGrams;delete preferences.anyWeight;delete sources.packageWeightGrams;delete sources.anyWeight;}
 if(changes.anyWeight===true){delete preferences.packageWeightGrams;delete sources.packageWeightGrams;unrestricted.add('packageWeightGrams');}
 else if(changes.packageWeightGrams!=null)preferences.anyWeight=false;
 const changed=reset||[...new Set([...Object.keys(memory.preferences),...Object.keys(preferences)])].some(key=>memory.preferences[key as keyof Preferences]!==preferences[key as keyof Preferences]);
 return {preferences,evidence:sources,lastProductIds:changed?[]:memory.lastProductIds,unrestricted:[...unrestricted],refinement:reset||typeChanged||speciesChanged||subtypeChanged?undefined:memory.refinement};
}
// Names match without accents or plural endings: "saches" finds "Sachê".
const ACCENTS:[string,string][]=[['á','a'],['à','a'],['â','a'],['ã','a'],['é','e'],['ê','e'],['í','i'],['ó','o'],['ô','o'],['õ','o'],['ú','u'],['ü','u'],['ç','c']].flatMap(([from,to])=>[[from,to],[from.toUpperCase(),to]] as [string,string][]);
const foldedName=ACCENTS.reduce((sql,[from,to])=>`REPLACE(${sql},'${from}','${to}')`,'LOWER(p.name)');
export function nameTerms(keyword:string){
 const w=keyword.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
 if(w.length<=3||!w.endsWith('s'))return w?[w]:[];
 return [w,w.endsWith('oes')||w.endsWith('aes')?w.slice(0,-3)+'ao':w.endsWith('ais')?w.slice(0,-2)+'l':w.slice(0,-1)];
}
const code=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
export const searchSchema=z.object({offset:z.number().int().min(0).max(30).optional().describe('0 inicialmente; 3,6 etc. somente para pedir mais opções.')}).strict();
export function buildCatalogQuery(p:Preferences,keywords:readonly string[]=[],includeUnknownSpecies=false,tenantId:string){
 preferencesSchema.parse(p);
 const conditions=["a.tenant_id=?","a.module_id='petshop'","a.search_enabled=1","p.status='active'"];
 const params:(string|number)[]=[tenantId];
 for(const [column,value] of [['product_type',p.productType],['life_stage',p.lifeStage],['package_weight_grams',p.packageWeightGrams]] as const){if(value!=null){conditions.push(`${column==='package_weight_grams'?'COALESCE(x.net_weight_grams,a.package_weight_grams)':`COALESCE(x.${column},a.${column})`}=?`);params.push(value);}}
 if(p.saleForm){conditions.push(`${foodSaleForm}=?`);params.push(p.saleForm);}
 if(p.brand){const brand=code(p.brand);params.push(brand==='wiskas'?'whiskas':brand);
  if(p.productName){conditions.push("(COALESCE(x.brand_code,a.brand_code)=? OR (COALESCE(x.brand_code,a.brand_code) IS NULL AND p.name LIKE ? ESCAPE '\\'))");params.push('%'+p.brand.replace(/[\\%_]/g,'\\$&')+'%');}
  else conditions.push('COALESCE(x.brand_code,a.brand_code)=?');
 }
 if(p.species){
  const profile="SELECT 1 FROM catalog_product_profile_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id",legacy="SELECT 1 FROM catalog_product_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id";
  conditions.push(`(EXISTS(${profile} AND s.species=?) OR (NOT EXISTS(${profile}) AND EXISTS(${legacy} AND s.species=?))${includeUnknownSpecies?` OR (NOT EXISTS(${profile}) AND NOT EXISTS(${legacy}))`:''})`);params.push(p.species,p.species);
 }
 if(p.animalSize){conditions.push('EXISTS(SELECT 1 FROM catalog_product_sizes s WHERE s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.product_id=a.product_id AND s.animal_size=?)');params.push(p.animalSize);}
 if(p.maxPriceCents!=null){conditions.push('p.price_cents<=?');params.push(p.maxPriceCents);}
 addClassificationFilters(p,conditions,params);
 for(const keyword of [...keywords,...(p.nameTerms??[]),...[p.productLine,p.productName].filter((v):v is string=>!!v).flatMap(v=>v.split(/\s+/))]){
  const terms=nameTerms(keyword);if(!terms.length)continue;
  const alternatives=terms[0]==='light'?['light','ligth']:terms;
  conditions.push('('+alternatives.map(()=>`${foldedName} LIKE ? ESCAPE '\\'`).join(' OR ')+')');
  params.push(...alternatives.map(v=>'%'+v.replace(/[\\%_]/g,'\\$&')+'%'));
 }
 return {from:`FROM catalog_product_attributes a JOIN catalog_products p ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.product_id ${profileJoin} WHERE ${conditions.join(' AND ')}`,params};
}
export type Product={id:string;name:string;price_cents:number;brand_label:string|null;sale_form:string|null;package_weight_grams:number|null;life_stage:string|null;review_state:string;subtype?:string|null;net_volume_ml?:number|null;capacity_ml?:number|null;size_label?:string|null;size_number?:number|null;pack_count?:number|null;food_form?:string|null;requires_professional_guidance?:number|null;attributes_json?:string|null;species_confirmation_required?:boolean;billing_unit?:'unknown';stock_confirmed?:false};
const columns=`p.id,p.name,p.price_cents,COALESCE(x.brand_label,a.brand_label) brand_label,${foodSaleForm} sale_form,COALESCE(x.net_weight_grams,a.package_weight_grams) package_weight_grams,COALESCE(x.life_stage,a.life_stage) life_stage,COALESCE(x.review_state,a.review_state) review_state,${profileColumns}`;
export async function searchProducts(db:D1Database,preferences:Preferences,input:unknown,unrestricted:readonly (keyof Preferences)[]=[],tenantId:string){
 const {offset=0}=searchSchema.parse(input);let query=buildCatalogQuery(preferences,[],false,tenantId);
 let count=await db.prepare(`SELECT COUNT(*) AS total ${query.from}`).bind(...query.params).first<{total:number}>();if(!count)throw new Error('CATALOG_QUERY_FAILED');
 let speciesConfirmationRequired=false;
 // A named product with missing classification is a candidate, never a suitability claim.
 if(count.total===0&&(preferences.productName||preferences.nameTerms?.length||preferences.productLine)&&preferences.species){
  query=buildCatalogQuery(preferences,[],true,tenantId);
  count=await db.prepare(`SELECT COUNT(*) AS total ${query.from}`).bind(...query.params).first<{total:number}>();if(!count)throw new Error('CATALOG_QUERY_FAILED');
  speciesConfirmationRequired=count.total>0;
 }
 if(count.total>12||(count.total>0&&preferences.productType==='feed'&&!preferences.species&&!preferences.productName&&!unrestricted.includes('species'))){
  const facets=await db.prepare(`SELECT DISTINCT a.brand_label,a.life_stage,a.sale_form,a.package_weight_grams ${query.from} ORDER BY a.brand_label,a.package_weight_grams LIMIT 8`).bind(...query.params).all<{brand_label:string|null;life_stage:string|null;sale_form:string|null;package_weight_grams:number|null}>();
  const refinement=await chooseRefinement(db,query,preferences,unrestricted,true);
  return {status:'needs_refinement' as const,total:count.total,preferences,products:[],facets:facets.results,refinement,instruction:'Use a pergunta de refinamento baseada nos resultados. Não liste todo o catálogo nem repita perguntas já respondidas.'};
 }
 const result=await db.prepare(`SELECT ${columns} ${query.from} ORDER BY p.name,p.id LIMIT 4 OFFSET ?`).bind(...query.params,offset).all<Product>();if(!result.success)throw new Error('CATALOG_QUERY_FAILED');
 return {status:count.total===0?'no_matches' as const:'matches' as const,total:count.total,preferences,products:result.results.slice(0,3).map(p=>({...p,species_confirmation_required:speciesConfirmationRequired,billing_unit:'unknown' as const,stock_confirmed:false as const})),speciesConfirmationRequired,hasMore:result.results.length>3,instruction:'Use somente dados retornados. Estoque e unidade de cobrança não confirmados. Candidatos sem espécie exigem confirmação de adequação. Se não houver resultado, não remova filtros automaticamente.'};
}
export async function getProduct(db:D1Database,id:string,allowedIds:readonly string[],tenantId:string){
 if(!allowedIds.includes(id))return {status:'not_selected',instruction:'Busque primeiro. Não invente IDs.'};
 const product=await db.prepare(`SELECT ${columns} FROM catalog_products p LEFT JOIN catalog_product_attributes a ON p.tenant_id=a.tenant_id AND p.module_id=a.module_id AND p.id=a.product_id ${profileJoin} WHERE p.tenant_id=? AND p.module_id='petshop' AND p.id=? AND (a.search_enabled IS NULL OR a.search_enabled=1) AND p.status='active'`).bind(tenantId,id).first<Product>();
 const knownSpecies=product?await db.prepare("SELECT species FROM catalog_product_species WHERE tenant_id=? AND module_id='petshop' AND product_id=? UNION ALL SELECT species FROM catalog_product_profile_species WHERE tenant_id=? AND module_id='petshop' AND product_id=? LIMIT 1").bind(tenantId,id,tenantId,id).first<{species:string}>():null;
 return product?{status:'found',product:{...product,species_confirmation_required:!knownSpecies,billing_unit:'unknown' as const,stock_confirmed:false as const},stockConfirmed:false,ingredients:null,protein:null}:{status:'not_found'};
}
