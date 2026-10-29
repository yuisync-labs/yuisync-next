// Random customers for the Luna simulator. Each conversation draws a goal, a
// way of writing and a detour from the matrix below; the goal also says what
// the database must show at the end. Seeded, so a run can be repeated.
export type SimPet={id:'mel'|'luna'|'thor';name:string;species:'dog'|'cat';breed:string;weightKg:number}
export type SimExpect={
 appointments?:number;service?:string;serviceOneOf?:string[];transport?:string|null;hour?:number
 sales?:number;saleTotalCents?:number;fulfillment?:'counter'|'delivery'
 handoff?:boolean;newClient?:boolean;neverProducts?:string[];neverServices?:string[];replyMatches?:string
}
export type SimScenario={id:string;index:number;goal:string;style:string;detour:string;registered:boolean;persona:string;facts:string;expect:SimExpect}

export const PETS:Record<SimPet['id'],SimPet>={
 mel:{id:'mel',name:'Mel',species:'dog',breed:'Shih Tzu',weightKg:6},
 luna:{id:'luna',name:'Luna',species:'cat',breed:'Persa',weightKg:4},
 thor:{id:'thor',name:'Thor',species:'dog',breed:'Husky Siberiano',weightKg:25},
}
export const CUSTOMER={name:'Maria Teste',street:'Rua Muriaé',number:'200',neighborhood:'Santa Terezinha',city:'Muriaé',reference:'perto da farmácia'}

const STYLES=[
 'escreve normal, frases completas',
 'escreve curto e com abreviações de WhatsApp (vc, q, pq, tb, blz, qro)',
 'escreve com alguns erros de digitação e sem acentos',
 'manda tudo o que sabe numa mensagem só',
 'manda uma informação por mensagem, aos poucos',
]
const DETOURS=[
 'nenhum',
 'no meio da conversa pergunta o preço de outra coisa (ex.: corte de unha) e depois volta ao assunto',
 'responde uma pergunta da atendente com outra pergunta antes de responder',
 'antes de confirmar diz algo como "hmm, deixa eu ver" e só depois confirma',
]
const DAYS=['amanhã','sexta','segunda que vem','quinta'],HOURS=[9,10,14,15,16]

// Valid check digits; the numbers are fictitious.
function cpf(seed:number){
 const d=Array.from({length:9},(_,i)=>(seed*(i+7)+i*3+1)%10)
 for(const n of [9,10])d.push(((d.reduce((s,v,i)=>s+v*(n+1-i),0)*10)%11)%10)
 return `${d.slice(0,3).join('')}.${d.slice(3,6).join('')}.${d.slice(6,9).join('')}-${d.slice(9).join('')}`
}

type Goal={name:string;weight:number;registered:boolean;build:(o:{day:string;hour:number;n:number})=>{persona:string;facts:string;expect:SimExpect}}
const pet=(p:SimPet)=>`${p.name}, ${p.species==='dog'?'cachorro':'gata'} ${p.breed}, ${String(p.weightKg).replace('.',',')} kg`
const address=`${CUSTOMER.street}, ${CUSTOMER.number}, ${CUSTOMER.neighborhood}`
const GOALS:Goal[]=[
 {name:'banho, cliente leva',weight:3,registered:true,build:({day,hour})=>({persona:`Quer marcar um banho para a ${PETS.mel.name} ${day} às ${hour}h e vai levar ela na loja.`,facts:`Pet: ${pet(PETS.mel)}. Você mesma leva e busca o pet.`,expect:{appointments:1,service:'banho-p',transport:null,hour}})},
 {name:'banho com MotoDog',weight:3,registered:true,build:({day,hour})=>({persona:`Quer banho para a ${PETS.mel.name} ${day} às ${hour}h e quer que o MotoDog busque e leve.`,facts:`Pet: ${pet(PETS.mel)}. Endereço do cadastro (${address}) continua o mesmo.`,expect:{appointments:1,service:'banho-p',transport:'buscar_e_levar',hour}})},
 {name:'MotoDog para pet de 25 kg',weight:2,registered:true,build:({day,hour})=>({persona:`Quer banho para o ${PETS.thor.name} ${day} às ${hour}h com o MotoDog. Se disserem que o MotoDog não leva o Thor, aceita levar ele você mesma.`,facts:`Pet: ${pet(PETS.thor)}, pelo grosso de husky.`,expect:{appointments:1,serviceOneOf:['banho-g-duplo','banho-g-longo','banho-g-curto'],transport:null,hour}})},
 {name:'cliente novo: cadastro e banho',weight:3,registered:false,build:({day,hour,n})=>({persona:`É a primeira vez na loja. Quer banho para a cachorra ${day} às ${hour}h e vai levar. Passa os dados do cadastro quando pedirem.`,facts:`Seus dados: Joana Simulada, CPF ${cpf(n+3)}, nascida em 14/03/1990, CEP 36889-275, número 45, referência casa verde. Pet: Pipoca, cachorra Shih Tzu, 7 kg.`,expect:{appointments:1,service:'banho-p',newClient:true,hour}})},
 {name:'tosa: escolhe o tipo',weight:2,registered:true,build:({day,hour})=>({persona:`Quer uma tosa para a ${PETS.mel.name} ${day} às ${hour}h, não sabe qual. Pergunta a diferença e escolhe a tosa total. Vai levar.`,facts:`Pet: ${pet(PETS.mel)}.`,expect:{appointments:1,service:'tosa-total-p',hour}})},
 {name:'muda o horário antes de confirmar',weight:2,registered:true,build:({day,hour})=>({persona:`Pede banho para a ${PETS.mel.name} ${day} às ${hour}h, vai levar. Quando vier o resumo, muda de ideia e pede às ${hour===16?15:hour+1}h no mesmo dia, e só então confirma.`,facts:`Pet: ${pet(PETS.mel)}.`,expect:{appointments:1,service:'banho-p',hour:hour===16?15:hour+1}})},
 {name:'desiste no meio',weight:1,registered:true,build:({day,hour})=>({persona:`Começa a marcar banho para a ${PETS.mel.name} ${day} às ${hour}h, mas quando vier o resumo desiste ("deixa pra outra hora") e encerra.`,facts:`Pet: ${pet(PETS.mel)}. Você levaria o pet.`,expect:{appointments:0,sales:0,handoff:false}})},
 {name:'compra para retirar',weight:2,registered:true,build:()=>({persona:'Quer 2 pacotes da ração Special Dog Ultralife adulto raças pequenas 3 kg, vai buscar na loja e paga no PIX.',facts:'Não precisa de entrega.',expect:{sales:1,saleTotalCents:10980,fulfillment:'counter',appointments:0}})},
 {name:'compra com entrega',weight:2,registered:true,build:()=>({persona:'Quer 1 ração Golden gato adulto frango 1 kg entregue em casa, paga com cartão na entrega.',facts:`Endereço do cadastro (${address}) está certo.`,expect:{sales:1,saleTotalCents:4690,fulfillment:'delivery',appointments:0}})},
 {name:'produto sem estoque',weight:2,registered:true,build:()=>({persona:'Quer a ração Golden gato castrado salmão 1 kg. Se não tiver, pergunta se tem outra para gato castrado; se não gostar, agradece e encerra.',facts:'Pet: Luna, gata Persa castrada, 4 kg.',expect:{neverProducts:['golden-gato-castrado'],handoff:false,appointments:0}})},
 {name:'só pergunta preço',weight:2,registered:true,build:()=>({persona:`Só quer saber quanto custa o banho e a tosa total para a ${PETS.mel.name}. Não quer marcar agora; agradece e encerra.`,facts:`Pet: ${pet(PETS.mel)}.`,expect:{appointments:0,sales:0,handoff:false,replyMatches:'55'}})},
 {name:'sintoma de saúde',weight:1,registered:true,build:()=>({persona:`A ${PETS.mel.name} está vomitando desde ontem e você pergunta o que pode dar para ela.`,facts:`Pet: ${pet(PETS.mel)}.`,expect:{sales:0,appointments:0}})},
 {name:'quer falar com uma pessoa',weight:1,registered:true,build:()=>({persona:'Quer falar com alguém da loja sobre um problema no último banho. Insiste em falar com uma pessoa.',facts:'O problema: o laço do último banho veio solto.',expect:{handoff:true,appointments:0,sales:0}})},
 {name:'pede desconto',weight:1,registered:true,build:({day,hour})=>({persona:`Pede banho para a ${PETS.mel.name} ${day} às ${hour}h, vai levar, e tenta conseguir 30% de desconto. Se não der, confirma pelo preço normal.`,facts:`Pet: ${pet(PETS.mel)}.`,expect:{appointments:1,service:'banho-p',hour}})},
 {name:'só a tosa higiênica',weight:1,registered:true,build:({day,hour})=>({persona:`Quer só a tosa higiênica da ${PETS.mel.name}. Se explicarem que vem no banho, aceita o banho ${day} às ${hour}h e leva.`,facts:`Pet: ${pet(PETS.mel)}.`,expect:{neverServices:['higienica-detalhes'],serviceOneOf:['banho-p'],hour}})},
]

function rng(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
export function simulatorScenarios(count:number,seed:number):SimScenario[]{
 const r=rng(seed),total=GOALS.reduce((n,g)=>n+g.weight,0),pick=<T,>(list:readonly T[])=>list[Math.floor(r()*list.length)]
 return Array.from({length:count},(_,index)=>{
  // Every goal appears once before any repeats; then weighted draws.
  let goal=GOALS[index]
  if(index>=GOALS.length){let x=r()*total;goal=GOALS.find(g=>(x-=g.weight)<0)??GOALS[0]}
  const built=goal.build({day:pick(DAYS),hour:pick(HOURS),n:index})
  return {id:`SIM-${seed}-${index+1}`,index,goal:goal.name,style:pick(STYLES),detour:pick(DETOURS),registered:goal.registered,...built}
 })
}
