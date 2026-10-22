import {z} from 'zod';
import {searchSchema,type Preferences,type Product} from './catalog';
import {classificationCode,profileJoin,profileColumns,addClassificationFilters,chooseRefinement} from './classification';
export const categories={accessory:'Acessório',hygiene:'Higiene',toy:'Brinquedo',medicine:'Medicamento',aquarium:'Aquarismo',garden:'Jardinagem',beverage:'Bebidas',other:'Outro',treat:'Petisco'} as const;
export const categorySchema=z.enum(['accessory','hygiene','toy','medicine','aquarium','garden','beverage','other','treat']);
/** Resolve routing from catalog data when the model supplies only the requested subtype. */
export async function resolveCatalogCategory(db:D1Database,changes:Record<string,unknown>,tenantId:string){
 if(typeof changes.subtype!=='string'&&!changes.productType&&!changes.catalogCategory&&typeof changes.productName==='string'){
  const terms=changes.productName.trim().split(/\s+/),where=terms.map(()=>"p.name LIKE ? ESCAPE '\\'").join(' AND ')
  const found=await db.prepare("SELECT DISTINCT x.product_type FROM catalog_product_profiles x JOIN catalog_products p ON p.tenant_id=x.tenant_id AND p.module_id=x.module_id AND p.id=x.product_id WHERE x.tenant_id=? AND x.module_id='petshop' AND x.entity_kind='product' AND p.status='active' AND "+where+' LIMIT 2').bind(tenantId,...terms.map(t=>'%'+t.replace(/[\\%_]/g,'\\$&')+'%')).all<{product_type:string}>()
  if(found.results.length===1){const type=found.results[0].product_type;if(type==='feed'||type==='treat')changes.productType=type;else changes.catalogCategory=categorySchema.parse(type)}
 }
 if(typeof changes.subtype!=='string')return;
 const r=await db.prepare("SELECT x.product_type,MIN(x.requires_professional_guidance) guidance FROM catalog_product_profiles x JOIN catalog_products p ON p.tenant_id=x.tenant_id AND p.module_id=x.module_id AND p.id=x.product_id WHERE x.tenant_id=? AND x.module_id='petshop' AND x.subtype=? AND x.entity_kind='product' AND p.status='active' GROUP BY x.product_type LIMIT 10").bind(tenantId,changes.subtype).all<{product_type:string;guidance:number}>();
 if(!r.success)throw Error('CATALOG_CATEGORY_FAILED');
 const explicit=changes.catalogCategory??changes.productType;
 const choices=explicit?r.results.filter(v=>v.product_type===explicit):r.results.length>1?r.results.filter(v=>v.guidance===0):r.results;
 if(choices.length!==1)throw Error('Subtipo não identificado de forma única no catálogo. Informe a categoria ou o produto específico.');
 const type=choices[0].product_type;
 if(type==='feed'||type==='treat'){changes.productType=type;delete changes.catalogCategory;}
 else {changes.catalogCategory=categorySchema.parse(type);delete changes.productType;}
}
export async function resolveVolumeDimension(db:D1Database,changes:Record<string,unknown>,before:Preferences,field:keyof Preferences|undefined,tenantId:string){
 if(changes.netVolumeMl==null||changes.capacityMl==null||changes.netVolumeMl!==changes.capacityMl)return;
 if(field==='netVolumeMl'){delete changes.capacityMl;return;}
 if(field==='capacityMl'){delete changes.netVolumeMl;return;}
 const subtype=changes.subtype??before.subtype;
 if(typeof subtype!=='string')throw Error('AMBIGUOUS_VOLUME_DIMENSION');
 const r=await db.prepare("SELECT SUM(net_volume_ml IS NOT NULL) volumes,SUM(capacity_ml IS NOT NULL) capacities FROM catalog_product_profiles WHERE tenant_id=? AND module_id='petshop' AND subtype=? AND entity_kind='product'").bind(tenantId,subtype).first<{volumes:number;capacities:number}>();
 if(r?.volumes&&!r.capacities){delete changes.capacityMl;return;}
 if(r?.capacities&&!r.volumes){delete changes.netVolumeMl;return;}
 throw Error('AMBIGUOUS_VOLUME_DIMENSION');
}
export async function searchOtherProducts(db:D1Database,p:Preferences,input:unknown,unrestricted:readonly (keyof Preferences)[]=[],tenantId:string){
 const category=categories[categorySchema.parse(p.catalogCategory)],{offset=0}=searchSchema.parse(input);
 const conditions=["p.tenant_id=?","p.module_id='petshop'","p.status='active'","(x.product_type=? OR (x.product_id IS NULL AND p.category=?))","(a.search_enabled IS NULL OR a.search_enabled=1)","(x.entity_kind='product' OR (x.product_id IS NULL AND a.product_type='treat'))"];
 const params:(string|number)[]=[tenantId,categorySchema.parse(p.catalogCategory),category];
 if(p.brand){conditions.push('COALESCE(x.brand_code,a.brand_code)=?');params.push(classificationCode(p.brand));}
 for(const term of [p.productName,p.productLine,...(p.nameTerms??[])].filter((s):s is string=>!!s).flatMap(s=>s.split(/\s+/))){conditions.push("p.name LIKE ? ESCAPE '\\'");params.push('%'+term.replace(/[\\%_]/g,'\\$&')+'%');}
 if(p.maxPriceCents!=null){conditions.push('p.price_cents<=?');params.push(p.maxPriceCents);}
 // Unclassified suitability is exposed as pending rather than inferred from names.
 const knownSpecies="EXISTS(SELECT 1 FROM catalog_product_profile_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id) OR EXISTS(SELECT 1 FROM catalog_product_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id)";
 if(p.species){conditions.push("(EXISTS(SELECT 1 FROM catalog_product_profile_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id AND s.species=?) OR EXISTS(SELECT 1 FROM catalog_product_species s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id AND s.species=?) OR (NOT ("+knownSpecies+") AND (p.species_target IS NULL OR p.species_target='' OR p.species_target='all' OR p.species_target=?)))");params.push(p.species,p.species,p.species);}
 if(p.lifeStage){conditions.push('COALESCE(x.life_stage,a.life_stage)=?');params.push(p.lifeStage);}
 if(p.packageWeightGrams!=null){conditions.push('COALESCE(x.net_weight_grams,a.package_weight_grams)=?');params.push(p.packageWeightGrams);}
 if(p.saleForm){conditions.push("(a.sale_form=? OR (a.sale_form IS NULL AND ?='packaged' AND x.pack_count>0))");params.push(p.saleForm,p.saleForm);}
 if(p.animalSize){conditions.push('EXISTS(SELECT 1 FROM catalog_product_sizes s WHERE s.tenant_id=p.tenant_id AND s.module_id=p.module_id AND s.product_id=p.id AND s.animal_size=?)');params.push(p.animalSize);}
 addClassificationFilters(p,conditions,params);
 const from=`FROM catalog_products p LEFT JOIN catalog_product_attributes a ON a.tenant_id=p.tenant_id AND a.module_id=p.module_id AND a.product_id=p.id ${profileJoin} WHERE ${conditions.join(' AND ')}`;
 const count=await db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params).first<{total:number}>();if(!count)throw Error('CATALOG_QUERY_FAILED');
 if(count.total>3)return {status:'needs_refinement' as const,total:count.total,preferences:p,products:[],category,refinement:await chooseRefinement(db,{from,params},p,unrestricted,false)};
 const rows=await db.prepare(`SELECT p.id,p.name,p.price_cents,COALESCE(x.brand_label,a.brand_label) brand_label,a.sale_form,COALESCE(x.net_weight_grams,a.package_weight_grams) package_weight_grams,COALESCE(x.life_stage,a.life_stage) life_stage,COALESCE(x.review_state,a.review_state,'unclassified') review_state,${profileColumns},CASE WHEN x.domain<>'petshop' OR (${knownSpecies}) THEN 0 ELSE 1 END AS species_confirmation_required ${from} ORDER BY p.name,p.id LIMIT 4 OFFSET ?`).bind(...params,offset).all<Product>();if(!rows.success)throw Error('CATALOG_QUERY_FAILED');
 return {status:count.total?'matches' as const:'no_matches' as const,total:count.total,preferences:p,category,products:rows.results.slice(0,3).map(v=>({...v,species_confirmation_required:!!v.species_confirmation_required,stock_confirmed:false as const})),speciesConfirmationRequired:rows.results.some(v=>!!v.species_confirmation_required),hasMore:rows.results.length>3};
}
