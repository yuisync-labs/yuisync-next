import type { Preferences } from './catalog';
export const normalized=(text:string)=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
export function authorizedCatalogRemoval(before:Preferences,remove:readonly (keyof Preferences)[],text:string){
 const source=normalized(text)
 const dimensions:Partial<Record<keyof Preferences,RegExp>>={brand:/\bmarcas?\b/,species:/\b(animal|especie)\b/,lifeStage:/\b(idade|fase)\b/,saleForm:/\b(embalagem|pacote|granel)\b/,packageWeightGrams:/\b(peso|kg|tamanho)\b/,anyWeight:/\b(peso|kg|tamanho)\b/,foodForm:/\b(forma|seca|umida)\b/,flavor:/\bsabor\b/,color:/\bcor\b/,material:/\bmaterial\b/,animalSize:/\bporte\b/,sizeLabel:/\btamanho\b/,sizeNumber:/\b(numero|tamanho)\b/,netVolumeMl:/\bvolume\b/,capacityMl:/\bcapacidade\b/,packCount:/\b(unidades|embalagem)\b/,maxPriceCents:/\b(preco|valor|orcamento|limite)\b/,productType:/\b(tipo|produto)\b/,catalogCategory:/\b(categoria|produto)\b/,subtype:/\b(tipo|produto)\b/,productName:/\b(nome|produto|modelo)\b/,productLine:/\blinha\b/,nameTerms:/\b(nome|produto)\b/}
 const denied=/\bnao (?:quero (?:tirar|remover)|(?:pode )?(?:tirar|remover|ignorar|desconsiderar|retirar|remova|tire))\b/.test(source)
 const consent=!denied&&/\b(qualquer|outras?|outros?|tanto faz|sem preferencia|sem limite|nao importa|nao tenho preferencia)\b|\b(?:pode |quero )?(?:tirar|remover|ignorar|desconsiderar|retirar)\b/.test(source)
 const allowed=remove.filter(key=>before[key]!=null&&consent&&dimensions[key]?.test(source))
 return {allowed,blocked:remove.filter(key=>before[key]!=null&&!allowed.includes(key))}
}
export function validateCatalogChanges(before:Preferences,changes:Record<string,unknown>,text:string,refinementField?:keyof Preferences){
 const source=normalized(text);
 if(changes.animalSize!=null){
  const explicit:Record<string,RegExp>={small:/\b(pequen[oa]s?|mini|small)\b/,medium:/\b(medi[oa]s?|medium)\b/,large:/\b(grandes?|large)\b/,giant:/\b(gigantes?|giant)\b/};
  if(!explicit[String(changes.animalSize)]?.test(source))throw Error('Peso do pet não define porte nem medida do produto. animalSize exige porte explicitamente informado; não converta 12 kg em medium.');
 }
 if(changes.anyWeight===true&&!/\b(peso|pesos|kg|quilos?|gramas?|tamanhos?)\b/.test(source)&&refinementField!=='packageWeightGrams')throw Error('Qualquer marca não significa qualquer peso. anyWeight deve ser null sem dispensa explícita de peso.');
 if(changes.sizeLabel!=null&&!new RegExp(`\\b${String(changes.sizeLabel).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(source))throw Error('sizeLabel deve ser tamanho literalmente informado. Não suponha P para filhote.');
 if((changes.foodForm==='dry'||changes.subtype==='dry_food')&&!/\b(seca|seco|extrusad[oa])\b/.test(source))throw Error('Ração genérica não informa forma seca. Omita foodForm e subtype=dry_food; preserve apenas os critérios pedidos.');
 if(changes.foodForm==='wet'&&!/\b(umid[oa]s?|saches?|pates?)\b/.test(source))throw Error('Molinho/macio é textura, não forma úmida. Omita foodForm; textura ausente no cadastro exige esclarecimento, sem afirmar adequação.');
 const amounts=[...source.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|quilos?|quilogramas?|g|gramas?)\b/g)].map(m=>Number(m[1].replace(',','.'))*(/^(kg|quilo)/.test(m[2])?1000:1));
 if(changes.sizeNumber!=null&&refinementField!=='sizeNumber'&&!/\b(numero|tamanho|tam)\b|\bn[º°.]?\s*\d/i.test(source))throw Error('sizeNumber precisa de número de tamanho; peso ou capacidade não definem tamanho.');
 if(changes.packCount!=null&&refinementField!=='packCount'&&!new RegExp(`\\b0*${changes.packCount}\\s*(unidades?|unid\\.?|und|un)\\b|\\bc\\s*[/]\\s*0*${changes.packCount}\\b`,'i').test(source))throw Error('packCount precisa de unidades dentro da embalagem, não peso/volume ou quantidade comprada.');
 if(changes.saleForm==='packaged'&&!/\b(pacote|embalagem|saco|fechad[oa]|sache|pate)\b/.test(source)&&!amounts.length&&changes.packCount==null)throw Error('saleForm packaged precisa de embalagem explicitamente pedida. Use null se só escolheu uma variante.');
 if(changes.sizeLabel!=null&&/\d\s*(kg|g|ml|litros?)\b/.test(normalized(String(changes.sizeLabel))))throw Error('sizeLabel não é peso, volume ou capacidade.');
 if(changes.sizeLabel!=null&&/^(feed|treat)$/.test(String(changes.productType??before.productType))&&!/\b(tamanho|tam)\b/.test(source))throw Error('Alimento sem tamanho explícito não define sizeLabel.');
 if((changes.packageWeightGrams!=null||changes.saleForm==='packaged'||before.saleForm==='packaged')&&amounts.some(n=>n>100000))throw new Error('Peso fora do limite de 100 kg. Peça correção da quantidade, sem buscar outro peso.');
 if(changes.saleForm==='bulk'&&before.saleForm!=='bulk'&&!/\bgranel\b/.test(source))throw new Error(`bulk precisa de granel explícito; pacote continua packaged.${amounts.length===1?` Use saleForm=packaged e packageWeightGrams=${amounts[0]}.`:''} Não avalie se o peso é comum: registre o peso solicitado, mesmo sem produto correspondente.`);
 if(before.saleForm==='bulk'&&changes.saleForm==='packaged'&&!/\b(pacote|embalagem|saco|fechado|fechada)\b/.test(source))throw new Error('Quantidade comprada de granel não muda para pacote. Preserve bulk; para total use action bulk_total.');
 if(changes.packageWeightGrams!=null){
  if(amounts.length&&!amounts.includes(Number(changes.packageWeightGrams)))throw new Error('Peso convertido incompatível com a unidade escrita; kg multiplica por 1000. Não substitua por outro peso.');
 }
 for(const key of ['netVolumeMl','capacityMl'] as const){
  if(changes[key]==null)continue;
  const volumes=[...source.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|l|litros?)\b/g)].map(m=>Number(m[1].replace(',','.'))*(/^(l|litro)/.test(m[2])?1000:1));
  const contextual=refinementField===key&&/^\s*\d+(?:[.,]\d+)?\s*$/.test(source)&&Number(source.replace(',','.'))===changes[key];
  if(!volumes.includes(Number(changes[key]))&&!contextual)throw Error('Volume/capacidade precisa da unidade escrita ou de resposta à pergunta correspondente. Não converta peso em volume.');
 }
 for(const key of ['sizeNumber','packCount'] as const){if(changes[key]!=null&&!new RegExp(`\\b0*${changes[key]}\\b`).test(source))throw Error('Tamanho/quantidade precisa do número informado pelo cliente.');}
 for(const key of ['material','color','flavor'] as const){if(changes[key]!=null&&!source.includes(normalized(String(changes[key]))))throw Error(`${key} precisa ser uma característica explicitamente solicitada.`);}
}

/** Discard unsupported model dimensions, while preserving the customer's supported criteria. */
export function supportedClassificationChanges(before:Preferences,changes:Record<string,unknown>,text:string,refinementField?:keyof Preferences){
 const supported={...changes};const discarded:Record<string,string>={};
 if(supported.sizeLabel!=null&&/^\d+$/.test(String(supported.sizeLabel))){
  if(supported.sizeNumber==null)supported.sizeNumber=Number(supported.sizeLabel);
  discarded.sizeLabel='Tamanho numérico usa sizeNumber; não duplicar em sizeLabel.';delete supported.sizeLabel;
 }
 if(supported.species!=null){
  const mentions:Record<string,RegExp>={dog:/\b(cachorros?|caes|cao|canin[oa]s?|dog)\b/,cat:/\b(gatos?|gatas?|felin[oa]s?|cat)\b/,bird:/\b(aves?|passaros?|bird|calopsitas?|papagaios?)\b/,rabbit:/\b(coelhos?|rabbit)\b/,rodent:/\b(roedores?|roedor|hamsters?|rodent|porquinho)\b/,fish:/\b(peixes?|fish)\b/};
  if(!mentions[String(supported.species)]?.test(normalized(text))){discarded.species='Espécie não foi informada; não inferir de marca ou tipo de produto.';delete supported.species;}
 }
 for(const key of ['animalSize','netVolumeMl','capacityMl','sizeLabel','sizeNumber','packCount','foodForm','subtype','saleForm','anyWeight'] as const){
  if(supported[key]==null||key==='subtype'&&supported[key]!=='dry_food')continue;
  try{validateCatalogChanges(before,{[key]:supported[key],...(key==='sizeLabel'?{productType:supported.productType}:{}),...(key==='saleForm'&&supported.packCount!=null?{packCount:supported.packCount}:{})},text,refinementField);}
  catch(error){const reason=error instanceof Error?error.message:'invalid';if(reason.startsWith('Peso fora do limite'))throw error;discarded[key]=reason;delete supported[key];}
 }
 return {changes:supported,discarded};
}
