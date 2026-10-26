// Food products imported from the store's spreadsheet arrive with only a name,
// a category and sometimes a species. Search reads structured attributes, so
// unclassified foods were invisible. This derives the attributes from the name,
// marks them 'suggested', and never overwrites a reviewed classification.
type Row={id:string;name:string;category:string;species_target:string|null;unit:string|null;updated_at_ms:number};
export type FoodAttributes={product_type:'feed'|'treat';brand_code:string|null;brand_label:string|null;life_stage:'puppy'|'adult'|'senior'|null;sale_form:'bulk'|'packaged'|null;package_weight_grams:number|null;food_form:'dry'|'wet'|null;species:string[];sizes:string[]};
const words=(s:string)=>' '+s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/[^A-Z0-9+,]+/g,' ').trim()+' ';
const has=(w:string,re:RegExp)=>re.test(w);
// Words that open a food name without being its brand.
const GENERIC=new Set(['GRANEL','RACAO','RACOES','BISCOITO','BISCOITOS','BIFINHO','BIFINHOS','PETISCO','PETISCOS','OSSO','OSSOS','PATE','SACHE','ALIMENTO','MISTURA','KIT','PARA','COM','SABOR','FARINHA','ORELHA','PE','PALETA','NUGGETS','SNACKS','SNACK','CANISTER']);
const code=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const label=(s:string)=>s.charAt(0)+s.slice(1).toLowerCase();
const tokens=(name:string)=>words(name).trim().split(' ').filter(t=>/^[A-Z][A-Z0-9]{2,}$/.test(t)&&!GENERIC.has(t));
// A brand is a leading name token shared by several products of the store.
export function brandCandidates(names:string[]){const counts=new Map<string,number>();for(const n of names){const t=tokens(n)[0];if(t)counts.set(t,(counts.get(t)??0)+1)}return new Set([...counts].filter(([,n])=>n>=3).map(([t])=>t))}
export function classifyFood(row:Pick<Row,'name'|'category'|'species_target'|'unit'>,brands:Set<string>):FoodAttributes|null{
 const product_type=row.category==='Ração'?'feed':row.category==='Petisco'?'treat':null;if(!product_type)return null;
 const w=words(row.name);
 const species=[...(has(w,/ (CAO|CAES|DOG|DOGS|CACHORRO|CACHORROS|CANINO|CANINOS) /)?['dog']:[]),...(has(w,/ (GATO|GATOS|CAT|CATS|FELINO|FELINOS|KITTEN) /)?['cat']:[]),...(has(w,/ (CALOPSITA|CALOPSITAS|PERIQUITO|PERIQUITOS|PASSARO|PASSAROS|AVES|PAPAGAIO|CANARIO) /)?['bird']:[]),...(has(w,/ (ROEDOR|ROEDORES|HAMSTER|PORQUINHO) /)?['rodent']:[]),...(has(w,/ (COELHO|COELHOS|BUNNY) /)?['rabbit']:[])];
 if(!species.length&&(row.species_target==='dog'||row.species_target==='cat'))species.push(row.species_target);
 const life_stage=has(w,/ (FILHOTE|FILHOTES|JUNIOR|PUPPY|KITTEN) /)?'puppy':has(w,/ (SENIOR|IDOSO|IDOSOS|7\+|\+7) /)?'senior':has(w,/ (ADULTO|ADULTOS|AD|ADULT) /)?'adult':null;
 const bulk=row.unit==='KG'||w.startsWith(' GRANEL ');
 const weights=[...w.matchAll(/ (\d+(?:,\d+)?) ?(KG|G|GR) /g)].map(m=>Math.round(Number(m[1].replace(',','.'))*(m[2]==='KG'?1000:1))).filter(n=>n>0);
 const package_weight_grams=bulk?null:weights.at(-1)??null;
 const sizes=new Set<string>();
 if(has(w,/ (RP|MINI|PEQ|PEQUENA|PEQUENAS|PEQUENO|SMALL) /))sizes.add('small');
 if(has(w,/ (RMG|MEDIAS|MEDIA|MEDIO|MED) /))sizes.add('medium');
 if(has(w,/ (RMG|RG|RGG|GRANDE|GRANDES|GDE) /))sizes.add('large');
 if(has(w,/ (RGG|GIGANTE|GIGANTES) /))sizes.add('giant');
 if(has(w,/ TODAS AS RACAS /))['small','medium','large','giant'].forEach(s=>sizes.add(s));
 const brand=tokens(row.name).find(t=>brands.has(t))??null;
 return {product_type,brand_code:brand?code(brand):null,brand_label:brand?label(brand):null,life_stage,sale_form:bulk?'bulk':package_weight_grams?'packaged':null,package_weight_grams,food_form:product_type==='feed'?(has(w,/ (SACHE|PATE|LATA|UMIDO|WET) /)?'wet':'dry'):null,species,sizes:[...sizes]};
}
// Classifies food products that have no attributes yet, or whose suggested
// attributes predate the product's last edit. Cheap no-op once up to date.
export async function ensureFoodClassified(db:D1Database,tenantId:string){
 const stale=await db.prepare("SELECT p.id,p.name,p.category,p.species_target,json_extract(p.bot_metadata_json,'$.unit') unit,p.updated_at_ms FROM catalog_products p LEFT JOIN catalog_product_attributes a ON a.tenant_id=p.tenant_id AND a.module_id=p.module_id AND a.product_id=p.id WHERE p.tenant_id=? AND p.module_id='petshop' AND p.status='active' AND p.category IN ('Ração','Petisco') AND (a.product_id IS NULL OR (a.review_state='suggested' AND a.revision<>'auto:'||p.updated_at_ms))").bind(tenantId).all<Row>()
 if(!stale.results.length)return 0
 const names=await db.prepare("SELECT name FROM catalog_products WHERE tenant_id=? AND module_id='petshop' AND status='active' AND category IN ('Ração','Petisco')").bind(tenantId).all<{name:string}>()
 const brands=brandCandidates(names.results.map(r=>r.name)),now=Date.now(),statements:D1PreparedStatement[]=[]
 for(const row of stale.results){
  const f=classifyFood(row,brands);if(!f)continue
  statements.push(
   db.prepare("DELETE FROM catalog_product_species WHERE tenant_id=? AND module_id='petshop' AND product_id=?").bind(tenantId,row.id),
   db.prepare("DELETE FROM catalog_product_sizes WHERE tenant_id=? AND module_id='petshop' AND product_id=?").bind(tenantId,row.id),
   db.prepare("INSERT INTO catalog_product_attributes(tenant_id,module_id,product_id,product_type,brand_code,brand_label,life_stage,sale_form,package_weight_grams,food_form,search_enabled,review_state,evidence_json,revision,created_at_ms) VALUES(?,'petshop',?,?,?,?,?,?,?,?,1,'suggested',?,?,?) ON CONFLICT(tenant_id,module_id,product_id) DO UPDATE SET product_type=excluded.product_type,brand_code=excluded.brand_code,brand_label=excluded.brand_label,life_stage=excluded.life_stage,sale_form=excluded.sale_form,package_weight_grams=excluded.package_weight_grams,food_form=excluded.food_form,evidence_json=excluded.evidence_json,revision=excluded.revision WHERE catalog_product_attributes.review_state='suggested'").bind(tenantId,row.id,f.product_type,f.brand_code,f.brand_label,f.life_stage,f.sale_form,f.package_weight_grams,f.food_form,JSON.stringify({source:'name',name:row.name}),'auto:'+row.updated_at_ms,now),
   ...f.species.map(s=>db.prepare("INSERT OR IGNORE INTO catalog_product_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop',?,?)").bind(tenantId,row.id,s)),
   ...f.sizes.map(s=>db.prepare("INSERT OR IGNORE INTO catalog_product_sizes(tenant_id,module_id,product_id,animal_size) VALUES(?,'petshop',?,?)").bind(tenantId,row.id,s)),
  )
 }
 for(let i=0;i<statements.length;i+=90)await db.batch(statements.slice(i,i+90))
 return stale.results.length
}

// Non-food products get a partial profile (type, subtype, species, size of the
// package) from category and name, so "areia de gato" or "coleira" can be found.
const CATEGORY_TYPES:Record<string,string>={'Acessório':'accessory','Higiene':'hygiene','Brinquedo':'toy','Medicamento':'medicine','Aquarismo':'aquarium','Jardinagem':'garden','Bebidas':'beverage','Outro':'other','Petisco':'treat'};
const SUBTYPES:[RegExp,string][]=[[/ (AREIA|GRANULADO|SILICA) /,'litter'],[/ TAPETE /,'pad'],[/ (CAMA|CAMINHA|COLCHONETE) /,'bed'],[/ (COLAR ELIZABETANO|ELIZABETANO) /,'protective_collar'],[/ (COLEIRA|COLEIRAS) /,'collar'],[/ PEITORA(L|IS) /,'harness'],[/ (GUIA|GUIAS) /,'leash'],[/ (SHAMPOO|XAMPU) /,'shampoo'],[/ CONDICIONADOR /,'conditioner'],[/ SABONETE /,'soap'],[/ (PERFUME|COLONIA|DEO COLONIA) /,'perfume'],[/ (ESCOVA|PENTE|RASQUEADEIRA|ALICATE|CORTADOR) /,'grooming_tool'],[/ (COMEDOURO|COMEDOUROS) /,'feeder'],[/ (BEBEDOURO|BEBEDOUROS|FONTE) /,'waterer'],[/ (ARRANHADOR|ARRANHADORES) /,'scratcher'],[/ (BOLA|BOLINHA|BOLAS) /,'ball'],[/ (PELUCIA) /,'plush'],[/ (CORDA|CORDAS) /,'rope'],[/ (MORDEDOR|MORDEDORES) /,'chew_toy'],[/ (TRANSPORTE|TRANSPORTADORA) /,'carrier'],[/ (ROUPA|CAMISETA|VESTIDO|CAPA|MOLETOM) /,'clothing'],[/ FRALDA /,'diaper'],[/ FOCINHEIRA /,'muzzle'],[/ (SACO|SACOS|SAQUINHO|SAQUINHOS|SACOLA) /,'waste_bag'],[/ EDUCADOR /,'toilet_training'],[/ VACINA /,'vaccine'],[/ (SUPLEMENTO|VITAMINA|SUPLEMENTOS) /,'supplement'],[/ (INSETICIDA|DEDETIZ) /,'environmental_insecticide'],[/ CATNIP /,'catnip_enrichment'],[/ (BIFINHO|BIFINHOS|TIRAS|STRIP) /,'strip'],[/ (BISCOITO|BISCOITOS|COOKIE) /,'biscuit'],[/ (OSSO|OSSOS|ORELHA|CASCO|CHIFRE) /,'natural_chew'],[/ (SACHE|PATE) /,'wet_food'],[/ (FERTILIZANTE|ADUBO) /,'fertilizer'],[/ VASO /,'planter'],[/ (AGUA MINERAL|AGUA) /,'water'],[/ (REFRIGERANTE|REFRI) /,'soft_drink'],[/ ENERGETICO /,'energy_drink']];
const UNSPECIFIED:Record<string,string>={accessory:'accessory_unspecified',medicine:'medicine_unspecified',toy:'toy_unspecified',treat:'treat_unspecified'};
export function profileFor(row:Pick<Row,'name'|'category'|'species_target'|'unit'>){
 const product_type=CATEGORY_TYPES[row.category];if(!product_type)return null;
 const w=words(row.name),subtype=SUBTYPES.find(([re])=>re.test(w))?.[1]??UNSPECIFIED[product_type]??null;
 const food=classifyFood({...row,category:row.category==='Petisco'?'Petisco':'Ração'},new Set());
 const species=food?.species.length?food.species:[];
 const volume=[...w.matchAll(/ (\d+(?:,\d+)?) ?(ML|L|LT|LITRO|LITROS) /g)].map(m=>Number(m[1].replace(',','.'))*(m[2]==='ML'?1:1000)).at(-1)??null;
 const weight=[...w.matchAll(/ (\d+(?:,\d+)?) ?(KG|G|GR) /g)].map(m=>Math.round(Number(m[1].replace(',','.'))*(m[2]==='KG'?1000:1))).at(-1)??null;
 const pack=[...w.matchAll(/ (?:C ?\/? ?)?(\d+) ?(UN|UNID|UNIDADES|UNDS) /g)].map(m=>Number(m[1])).at(-1)??null;
 return {product_type,subtype,species,domain:product_type==='garden'?'garden':product_type==='beverage'?'human_beverage':'petshop',net_volume_ml:volume&&volume>0?volume:null,net_weight_grams:weight&&weight>0?weight:null,pack_count:pack&&pack>0?pack:null,requires_professional_guidance:product_type==='medicine'&&subtype!=='supplement'?1:0};
}
export async function ensureCatalogProfiled(db:D1Database,tenantId:string){
 const stale=await db.prepare("SELECT p.id,p.name,p.category,p.species_target,json_extract(p.bot_metadata_json,'$.unit') unit,p.updated_at_ms FROM catalog_products p LEFT JOIN catalog_product_profiles x ON x.tenant_id=p.tenant_id AND x.module_id=p.module_id AND x.product_id=p.id WHERE p.tenant_id=? AND p.module_id='petshop' AND p.status='active' AND p.category IN ('Acessório','Higiene','Brinquedo','Medicamento','Aquarismo','Jardinagem','Bebidas','Outro','Petisco') AND (x.product_id IS NULL OR (x.review_state='partial' AND x.revision<>'auto:'||p.updated_at_ms))").bind(tenantId).all<Row>()
 if(!stale.results.length)return 0
 const now=Date.now(),statements:D1PreparedStatement[]=[]
 for(const row of stale.results){
  const f=profileFor(row);if(!f)continue
  statements.push(
   db.prepare("DELETE FROM catalog_product_profile_species WHERE tenant_id=? AND module_id='petshop' AND product_id=?").bind(tenantId,row.id),
   db.prepare("INSERT INTO catalog_product_profiles(tenant_id,module_id,product_id,entity_kind,domain,product_type,subtype,sale_unit,net_weight_grams,net_volume_ml,pack_count,requires_professional_guidance,review_state,source_name,source_category,attributes_json,evidence_json,revision,created_at_ms) VALUES(?,'petshop',?,'product',?,?,?,?,?,?,?,?,'partial',?,?,'{}',?,?,?) ON CONFLICT(tenant_id,module_id,product_id) DO UPDATE SET domain=excluded.domain,product_type=excluded.product_type,subtype=excluded.subtype,sale_unit=excluded.sale_unit,net_weight_grams=excluded.net_weight_grams,net_volume_ml=excluded.net_volume_ml,pack_count=excluded.pack_count,requires_professional_guidance=excluded.requires_professional_guidance,source_name=excluded.source_name,source_category=excluded.source_category,evidence_json=excluded.evidence_json,revision=excluded.revision WHERE catalog_product_profiles.review_state='partial'").bind(tenantId,row.id,f.domain,f.product_type,f.subtype,row.unit,f.net_weight_grams,f.net_volume_ml,f.pack_count,f.requires_professional_guidance,row.name,row.category,JSON.stringify({source:'name'}),'auto:'+row.updated_at_ms,now),
   ...f.species.map(s=>db.prepare("INSERT OR IGNORE INTO catalog_product_profile_species(tenant_id,module_id,product_id,species) VALUES(?,'petshop',?,?)").bind(tenantId,row.id,s)),
  )
 }
 for(let i=0;i<statements.length;i+=90)await db.batch(statements.slice(i,i+90))
 return stale.results.length
}
