import {z} from 'zod';
import type {Preferences} from './catalog';

export const classificationFields={
 subtype:z.string().trim().min(1).max(60).nullable().optional().describe('Tipo específico pedido: litter=areia/granulado sanitário de gato; pad=tapete higiênico; bed=cama; collar=coleira; shampoo=xampu; wet_food=alimento úmido; strip=bifinho. Não inferir uma preferência ausente.'),
 netVolumeMl:z.number().positive().max(1000000).nullable().optional(),
 capacityMl:z.number().positive().max(1000000).nullable().optional(),
 sizeLabel:z.string().trim().min(1).max(40).nullable().optional(),
 sizeNumber:z.number().int().min(0).max(200).nullable().optional(),
 packCount:z.number().int().positive().max(10000).nullable().optional(),
 material:z.string().trim().min(1).max(60).nullable().optional(),
 color:z.string().trim().min(1).max(60).nullable().optional(),
 flavor:z.string().trim().min(1).max(60).nullable().optional(),
 foodForm:z.enum(['dry','wet']).nullable().optional().describe('dry=seco; wet=úmido/sachê/patê. Molinho ou macio é textura, não wet.')
};
export const subtypeLabels:Record<string,string>={accessory_unspecified:'outro acessório',antiseptic:'antisséptico',ball:'bola',bed:'cama',biscuit:'biscoito',bone_shaped_toy:'brinquedo em formato de osso',carrier:'caixa de transporte',catnip_enrichment:'catnip',chew_toy:'mordedor',cleaning:'limpeza',clothing:'roupa',collar:'coleira',conditioner:'condicionador',creamy:'petisco cremoso',decoration:'decoração',diaper:'fralda',dry_food:'ração seca',energy_drink:'energético',environmental_insecticide:'inseticida ambiental',feeder:'comedouro',feeding_utensil:'utensílio de alimentação',fertilizer:'fertilizante',forage:'forragem',functional_snack:'petisco funcional',garden_tool:'ferramenta de jardinagem',grooming_tool:'escova ou pente',habitat:'habitat',harness:'peitoral',interactive_catnip:'brinquedo com catnip',latex:'brinquedo de látex',leash:'guia',litter:'areia ou granulado higiênico',medicine_unspecified:'outro medicamento',muzzle:'focinheira',natural_chew:'petisco para mastigar',oral_care:'higiene oral',pad:'tapete higiênico',perfume:'perfume',planter:'vaso',plush:'pelúcia',protective_collar:'colar de proteção',rope:'corda',safety:'acessório de segurança',scratcher:'arranhador',shampoo:'shampoo',snack:'petisco',soap:'sabonete',soft_drink:'refrigerante',strip:'petisco em tiras',substrate:'substrato',supplement:'suplemento',test_kit:'kit de teste',toilet_training:'educador sanitário',tool:'ferramenta',toy:'brinquedo',toy_unspecified:'outro brinquedo',transport:'transporte',treat_unspecified:'outro petisco',vaccine:'vacina',vinyl:'brinquedo de vinil',waste_bag:'saco higiênico',water:'água',waterer:'bebedouro',wet_food:'ração úmida'};
export const classificationCode=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
export const profileJoin=' LEFT JOIN catalog_product_profiles x ON x.tenant_id=p.tenant_id AND x.module_id=p.module_id AND x.product_id=p.id ';
// Earlier food attributes omit sale form for sachets whose package weight is unknown.
export const foodSaleForm="COALESCE(a.sale_form,CASE WHEN x.subtype='wet_food' AND (p.name LIKE '%SACHE%' OR p.name LIKE '%PATÊ%' OR p.name LIKE '%PATE%') THEN 'packaged' END)";
export const profileColumns="COALESCE(x.product_type,a.product_type) product_type,x.subtype,x.net_volume_ml,x.capacity_ml,x.size_label,x.size_number,x.pack_count,COALESCE(x.food_form,a.food_form) food_form,COALESCE(x.requires_professional_guidance,CASE WHEN EXISTS(SELECT 1 FROM catalog_product_tags t WHERE t.tenant_id=p.tenant_id AND t.module_id=p.module_id AND t.product_id=p.id AND t.tag_value='veterinary_guidance_required') THEN 1 ELSE 0 END) requires_professional_guidance,x.attributes_json";
export function addClassificationFilters(p:Preferences,conditions:string[],params:(string|number)[]){
 for(const [key,col] of [['subtype','subtype'],['netVolumeMl','net_volume_ml'],['capacityMl','capacity_ml'],['sizeLabel','size_label'],['sizeNumber','size_number'],['packCount','pack_count']] as const){const v=p[key];if(v!=null){conditions.push(`x.${col}=? COLLATE NOCASE`);params.push(v);}}
 if(p.foodForm){conditions.push('COALESCE(x.food_form,a.food_form)=?');params.push(p.foodForm);}
 for(const [key,facet] of [['material','material'],['color','color'],['flavor','flavor']] as const){const v=p[key];if(v){let condition='EXISTS(SELECT 1 FROM catalog_product_profile_values v WHERE v.tenant_id=p.tenant_id AND v.module_id=p.module_id AND v.product_id=p.id AND v.facet=? AND v.value_text=? COLLATE NOCASE)';params.push(facet,v);if(key==='flavor'){condition="("+condition+" OR (x.product_id IS NULL AND p.name LIKE ? ESCAPE '\\'))";params.push('%'+v.replace(/[\\%_]/g,'\\$&')+'%');}conditions.push(condition);}}
}
export type Refinement={field:keyof Preferences;question:string;options:{value:string|number;label:string;count:number}[]};
const labels:Record<string,Record<string,string>>={species:{dog:'cachorro',cat:'gato',bird:'ave',rodent:'roedor',rabbit:'coelho',fish:'peixe'},lifeStage:{puppy:'filhote',adult:'adulto',senior:'sênior'},saleForm:{bulk:'a granel',packaged:'pacote fechado'},foodForm:{dry:'seca',wet:'úmida'},subtype:subtypeLabels};
const questions:Partial<Record<keyof Preferences,string>>={subtype:'Qual tipo de produto você procura?',species:'É para qual animal?',brand:'Qual marca você prefere?',lifeStage:'É para qual fase da vida?',saleForm:'Você prefere a granel ou pacote fechado?',packageWeightGrams:'Qual peso de embalagem você procura?',foodForm:'Você procura ração seca ou úmida?',netVolumeMl:'Qual volume do produto você procura?',capacityMl:'Qual capacidade você procura?',sizeLabel:'Qual tamanho você procura?',sizeNumber:'Qual número de tamanho você procura?',packCount:'Quantas unidades por embalagem você procura?',material:'Qual material você prefere?',color:'Qual cor você prefere?',flavor:'Qual sabor você prefere?'};
export async function chooseRefinement(db:D1Database,query:{from:string;params:(string|number)[]},p:Preferences,unrestricted:readonly (keyof Preferences)[],food:boolean):Promise<Refinement>{
 const missing=(key:keyof Preferences)=>p[key]==null&&!unrestricted.includes(key)&&!(key==='packageWeightGrams'&&p.anyWeight);
 if(food&&p.productType==='feed'&&missing('species')&&!p.productName)return {field:'species',question:'É para qual animal?',options:[]};
 const candidates:[keyof Preferences,string][]=[
 ...(!food?[['subtype','x.subtype'] as [keyof Preferences,string]]:[]),
 ['species',"(SELECT GROUP_CONCAT(s.species) FROM catalog_product_profile_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id)"],
 ['brand','COALESCE(x.brand_label,a.brand_label)'],['lifeStage','COALESCE(x.life_stage,a.life_stage)'],
 ['saleForm',foodSaleForm],['packageWeightGrams','COALESCE(x.net_weight_grams,a.package_weight_grams)'],
 ['foodForm','COALESCE(x.food_form,a.food_form)'],['netVolumeMl','x.net_volume_ml'],['capacityMl','x.capacity_ml'],
 ['sizeLabel','x.size_label'],['sizeNumber','x.size_number'],['packCount','x.pack_count'],
 ...(['material','color','flavor'] as const).map(k=>[k,`(SELECT v.value_text FROM catalog_product_profile_values v WHERE v.tenant_id=p.tenant_id AND v.module_id=p.module_id AND v.product_id=p.id AND v.facet='${k}' ORDER BY v.ordinal LIMIT 1)`] as [keyof Preferences,string])];
 for(const [field,expr] of candidates){
  if(!missing(field)||field==='saleForm'&&!food||field==='packageWeightGrams'&&p.saleForm==='bulk')continue;
  const r=await db.prepare(`SELECT ${expr} value,COUNT(*) count ${query.from} GROUP BY value HAVING value IS NOT NULL AND value<>'' ORDER BY count DESC,value LIMIT 6`).bind(...query.params).all<{value:string|number;count:number}>();
  if(!r.success)throw Error('CATALOG_FACETS_FAILED');
  // Unknown classifications and multi-species values cannot establish suitability.
  const values=r.results.filter(v=>field!=='species'||!String(v.value).includes(',')).filter(v=>field!=='subtype'||!String(v.value).endsWith('_unspecified'));
  if(values.length<2)continue;
  const options=values.map(v=>({...v,label:labels[field]?.[String(v.value)]??(field==='packageWeightGrams'?`${Number(v.value)/1000} kg`:field==='netVolumeMl'||field==='capacityMl'?`${v.value} ml`:String(v.value))}));
  return {field,options,question:`${questions[field]} Há opções como ${options.slice(0,4).map(v=>v.label).join(', ')}.`};
 }
 return {field:'productName',options:[],question:'Qual produto específico você procura? Pode informar o nome ou uma característica que deseja.'};
}
