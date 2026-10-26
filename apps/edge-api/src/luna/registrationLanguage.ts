// A registration may only carry names the customer actually said. Breed, size
// and species words describe the pet; they are not its name ("um Yorkshire",
// "huskciberiano, médio"), and a contact label is not the customer's name.
const plain = (v: string) => ' ' + v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '
const BREED_STEMS = ['husk', 'siber', 'shih', 'shitz', 'poodle', 'labrador', 'golden', 'pug', 'bulldog', 'buldogue', 'yorkshire', 'york', 'maltes', 'lhasa', 'pinscher', 'spitz', 'lulu', 'schnauzer', 'dachshund', 'salsicha', 'beagle', 'border', 'collie', 'pastor', 'rottweiler', 'pitbull', 'pit', 'chihuahua', 'persa', 'siames', 'srd', 'vira', 'boxer', 'dalmata', 'akita', 'chow', 'doberman', 'maine', 'ragdoll', 'angora', 'bengal', 'sphynx', 'cocker', 'basset', 'bichon', 'pomerania', 'pequines', 'teckel', 'dogue', 'weimaraner', 'terrier', 'cachorro', 'cachorra', 'cao', 'gato', 'gata', 'dog', 'cat', 'filhote']
const SIZE_WORDS = new Set(['pequeno', 'pequena', 'medio', 'media', 'grande', 'porte', 'mini', 'gigante', 'filhote', 'adulto', 'idoso'])
const GENERIC_PEOPLE = new Set(['cliente', 'tutor', 'tutora', 'dono', 'dona', 'contato', 'usuario'])
// A breed-like word only counts as a name when it is introduced as one:
// "se chama Lulu", "o nome dela é Lulu", "meu pet é o Golden".
const NAMING = / (?:chama|chamad[oa]|nome (?:dele |dela |do pet )?e|e o|e a) $/
const looksLikeBreed = (name: string) => plain(name).trim().split(' ').some(word => SIZE_WORDS.has(word) || BREED_STEMS.some(stem => stem.length <= 4 ? word === stem || (stem.length === 4 && word.startsWith(stem)) : word.startsWith(stem)))
export function registrationIssue(args: Record<string, unknown>, said: string, newCustomer: boolean) {
  const text = plain(said), pet = String(args.pet_name ?? '').trim(), breed = String(args.breed ?? '').trim(), customer = String(args.customer_name ?? '').trim()
  if (newCustomer) {
    const words = plain(customer).trim().split(' ').filter(w => w && !/^\d+$/.test(w))
    if (!words.length || words.every(w => GENERIC_PEOPLE.has(w)) || !words.some(w => text.includes(' ' + w + ' ')))
      return { code: 'CUSTOMER_NAME_NOT_SAID', instruction: 'O cliente ainda não disse o próprio nome. Pergunte como ele se chama; não use nome de contato nem invente.' }
  }
  const at = pet ? text.indexOf(plain(pet)) : -1
  if (at < 0) return { code: 'PET_NAME_NOT_SAID', instruction: 'O cliente ainda não disse o nome do pet. Pergunte como o pet se chama.' }
  if (breed && plain(breed) === plain(pet) || looksLikeBreed(pet) && ![...text.matchAll(new RegExp(plain(pet).trim(), 'g'))].some(m => NAMING.test(text.slice(0, m.index))))
    return { code: 'PET_NAME_IS_BREED', instruction: `"${pet}" descreve raça, porte ou espécie, não é o nome do pet. Pergunte como o pet se chama.` }
  const weight = args.weight_kg == null ? null : Number(args.weight_kg)
  if (weight != null && !said.match(new RegExp(`(^|[^0-9.])${String(weight).replace('.', '[.,]')}([^0-9]|$)`)))
    return { code: 'WEIGHT_NOT_SAID', instruction: 'O cliente não disse esse peso. Use weight_kg null; uma faixa não é o peso do pet.' }
  if (breed && plain(breed).trim().split(' ').every(w => SIZE_WORDS.has(w)))
    return { code: 'BREED_IS_SIZE', instruction: `"${breed}" é porte, não raça. Use breed null ou a raça que o cliente disse.` }
  return null
}
