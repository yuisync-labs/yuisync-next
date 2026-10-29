// Breed names as the store should see them. Customers type "huskciberiano",
// "shitzu", "lhasa": the closest known breed replaces the typo; anything not
// close to a known breed stays as typed.
const BREEDS: [string, string[]][] = [
  ['SRD (sem raça definida)', ['srd', 'sem raca', 'sem raca definida', 'vira lata', 'viralata', 'vira-lata', 'mestico', 'mestica', 'misturado']],
  ['Shih Tzu', ['shih tzu', 'shitzu', 'shihtzu', 'shi tzu', 'chitzu']],
  ['Lhasa Apso', ['lhasa apso', 'lhasa', 'lasa']],
  ['Husky Siberiano', ['husky siberiano', 'husky', 'siberian husky']],
  ['Yorkshire Terrier', ['yorkshire terrier', 'yorkshire', 'york']],
  ['Poodle', ['poodle', 'pudle', 'poodle toy', 'poodle micro toy']],
  ['Maltês', ['maltes', 'maltez', 'maltese']],
  ['Spitz Alemão (Lulu da Pomerânia)', ['spitz alemao', 'spitz', 'lulu da pomerania', 'lulu', 'pomerania', 'pomeranian']],
  ['Golden Retriever', ['golden retriever', 'golden']],
  ['Labrador Retriever', ['labrador retriever', 'labrador']],
  ['Pastor Alemão', ['pastor alemao']],
  ['Border Collie', ['border collie', 'border']],
  ['Bulldog Francês', ['bulldog frances', 'buldogue frances', 'frances']],
  ['Bulldog Inglês', ['bulldog ingles', 'buldogue ingles']],
  ['Pug', ['pug']],
  ['Beagle', ['beagle', 'bigle']],
  ['Dachshund (Salsicha)', ['dachshund', 'salsicha', 'teckel', 'basset']],
  ['Pinscher', ['pinscher', 'pincher']],
  ['Chihuahua', ['chihuahua', 'chiuaua']],
  ['Schnauzer', ['schnauzer', 'snauzer']],
  ['Cocker Spaniel', ['cocker spaniel', 'cocker']],
  ['Rottweiler', ['rottweiler', 'rotweiler']],
  ['Pit Bull', ['pit bull', 'pitbull', 'american pit bull']],
  ['Chow Chow', ['chow chow', 'chowchow']],
  ['Akita', ['akita']],
  ['Boxer', ['boxer']],
  ['Dobermann', ['dobermann', 'doberman']],
  ['Bichon Frisé', ['bichon frise', 'bichon']],
  ['Pastor Belga', ['pastor belga', 'malinois']],
  ['Samoieda', ['samoieda', 'samoyed']],
  ['Cavalier King Charles', ['cavalier king charles', 'cavalier']],
  ['Jack Russell Terrier', ['jack russell terrier', 'jack russell']],
  ['West Highland White Terrier', ['west highland white terrier', 'westie']],
  ['Persa', ['persa', 'persian']],
  ['Siamês', ['siames', 'siamese']],
  ['Maine Coon', ['maine coon', 'mainecoon']],
  ['Angorá', ['angora']],
  ['Ragdoll', ['ragdoll']],
  ['Sphynx', ['sphynx', 'sphinx']],
  ['British Shorthair', ['british shorthair', 'british']],
  ['Bengal', ['bengal', 'bengala']],
]
const compact = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '')
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur }
  }
  return row[b.length]
}

export function canonicalBreed(raw: unknown): string | null {
  const typed = compact(String(raw ?? ''))
  if (typed.length < 3) return null
  let best: { name: string; cost: number } | null = null
  for (const [name, aliases] of BREEDS) for (const alias of aliases.map(compact)) {
    // Short names must match exactly; longer ones allow about one typo per five letters,
    // and long two-word names ("husckiberiano") one per four.
    const cost = alias === typed ? 0 : alias.length < 5 ? Infinity : distance(typed, alias)
    if (cost <= Math.max(1, Math.floor(alias.length / (alias.length >= 12 ? 4 : 5))) && (!best || cost < best.cost)) best = { name, cost }
  }
  return best?.name ?? null
}
