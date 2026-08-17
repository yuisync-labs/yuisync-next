const PRODUCT_HEADER_ALIASES = {
  legacyCode: ['codigo', 'código'],
  barcode: ['codigo barras', 'código barras', 'cod barras', 'ean'],
  name: ['descricao', 'descrição', 'produto', 'nome'],
  unit: ['unidade', 'und'],
  category: ['descricao grupo', 'descrição grupo', 'grupo', 'categoria'],
  costPrice: ['custo atual', 'prd_preco_custo_1', 'preco compra', 'preço compra'],
  price: ['preco venda', 'preço venda', 'prd_preco_venda_1'],
  stockQuantity: ['estoque inventariado', 'estoque', 'quantidade'],
  type: ['tipo produto'],
  status: ['status'],
}

const CLIENT_HEADER_ALIASES = {
  legacyCode: ['codigo', 'código', 'cli_pessoa'],
  personType: ['tipo pessoa'],
  name: ['razao social / nome', 'razão social / nome', 'nome', 'cliente'],
  nickname: ['fantasia / apelido', 'apelido', 'fantasia'],
  document: ['cnpj / cpf', 'cpf', 'cnpj'],
  rg: ['i.e / r.g', 'rg', 'ie'],
  phone: ['telefone', 'fone', 'celular', 'whatsapp'],
  email: ['email', 'e-mail'],
  address: ['logradouro', 'endereco', 'endereço', 'pes_end'],
  number: ['numero', 'número'],
  neighborhood: ['bairro'],
  city: ['nome cidade', 'cidade'],
  state: ['estado', 'uf'],
  reference: ['referencia', 'referência', 'pes_referencia'],
  notes: ['cli_observacao', 'cli_obs_nota', 'observacao', 'observação'],
  gender: ['pes_sexo', 'genero', 'gênero'],
  status: ['cli_status', 'status'],
  createdAt: ['cli_dt_cadastro', 'data cadastro'],
}

function normalizeHeader(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function cleanDigits(value) {
  return cleanText(value).replace(/\D+/g, '')
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = cleanText(value).replace(/[^\d,.-]/g, '')
  const text = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  const number = Number(text)
  return Number.isFinite(number) ? number : 0
}

function getByAliases(row, aliases) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]))
  for (const alias of aliases) {
    const value = normalized.get(normalizeHeader(alias))
    if (value !== undefined && value !== null && cleanText(value) !== '') return value
  }
  return null
}

function pick(row, aliases, fallback = '') {
  return cleanText(getByAliases(row, aliases) ?? fallback)
}

function isActiveStatus(status) {
  const value = cleanText(status).toUpperCase()
  return !value || ['A', 'ATIVO', 'TRUE', 'S', 'SIM'].includes(value)
}

function normalizeCategory(value) {
  const category = cleanText(value)
  if (!category) return 'Importacao Legado'
  return category
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace('Racao', 'Racao')
}

function inferSpecies(name = '', category = '') {
  const text = `${name} ${category}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(cat|gato|gatos|felino)\b/.test(text)) return 'cat'
  if (/\b(dog|cao|caes|canino|puppy|adulto|mini)\b/.test(text)) return 'dog'
  return null
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')
  )
}

function normalizeProductUnit(value) {
  const unit = String(value || '').trim().toUpperCase()
  return ['UN', 'KG', 'MIL'].includes(unit) ? unit : 'UN'
}

function mapProductRow(row) {
  const name = pick(row, PRODUCT_HEADER_ALIASES.name)
  const legacyCode = pick(row, PRODUCT_HEADER_ALIASES.legacyCode)
  if (!name || !legacyCode) return null

  const category = normalizeCategory(pick(row, PRODUCT_HEADER_ALIASES.category))
  const unit = normalizeProductUnit(pick(row, PRODUCT_HEADER_ALIASES.unit))
  const type = pick(row, PRODUCT_HEADER_ALIASES.type)
  const barcode = cleanDigits(pick(row, PRODUCT_HEADER_ALIASES.barcode)) || null
  const price = parseNumber(getByAliases(row, PRODUCT_HEADER_ALIASES.price))
  const costPrice = parseNumber(getByAliases(row, PRODUCT_HEADER_ALIASES.costPrice))
  const stockQuantity = parseNumber(getByAliases(row, PRODUCT_HEADER_ALIASES.stockQuantity))

  return {
    legacyCode,
    name,
    barcode,
    category,
    price,
    costPrice,
    stockQuantity,
    unit,
    minStock: 0,
    speciesTarget: inferSpecies(name, category),
    active: isActiveStatus(pick(row, PRODUCT_HEADER_ALIASES.status)),
    description: [
      `Importado do sistema legado`,
      legacyCode ? `codigo ${legacyCode}` : null,
      unit ? `unidade ${unit}` : null,
      type ? `tipo ${type}` : null,
    ].filter(Boolean).join(' | '),
  }
}

function mapClientRow(row) {
  const name = pick(row, CLIENT_HEADER_ALIASES.name)
  const legacyCode = pick(row, CLIENT_HEADER_ALIASES.legacyCode)
  if (!name || !legacyCode) return null

  const address = pick(row, CLIENT_HEADER_ALIASES.address)
  const number = pick(row, CLIENT_HEADER_ALIASES.number)
  const reference = pick(row, CLIENT_HEADER_ALIASES.reference)
  const notes = [
    pick(row, CLIENT_HEADER_ALIASES.notes),
    reference ? `Referencia: ${reference}` : null,
  ].filter(Boolean).join(' | ')

  return {
    legacyCode,
    type: 'pet',
    name,
    document: cleanDigits(pick(row, CLIENT_HEADER_ALIASES.document)) || null,
    phone: cleanDigits(pick(row, CLIENT_HEADER_ALIASES.phone)) || null,
    email: pick(row, CLIENT_HEADER_ALIASES.email) || null,
    address: [address, number].filter(Boolean).join(', ') || null,
    neighborhood: pick(row, CLIENT_HEADER_ALIASES.neighborhood) || null,
    city: pick(row, CLIENT_HEADER_ALIASES.city) || null,
    notes: notes || null,
    active: isActiveStatus(pick(row, CLIENT_HEADER_ALIASES.status)),
    details: compactObject({
      legacy_code: legacyCode,
      legacy_person_type: pick(row, CLIENT_HEADER_ALIASES.personType),
      nickname: pick(row, CLIENT_HEADER_ALIASES.nickname),
      rg: pick(row, CLIENT_HEADER_ALIASES.rg),
      state: pick(row, CLIENT_HEADER_ALIASES.state),
      reference,
      gender: pick(row, CLIENT_HEADER_ALIASES.gender),
      legacy_created_at: pick(row, CLIENT_HEADER_ALIASES.createdAt),
    }),
  }
}

async function parseWorkbook(file) {
  const extension = String(file?.name || '').toLowerCase().split('.').pop()

  if (extension === 'xls') {
    throw new Error('O formato .xls nao e mais aceito por seguranca. Converta o arquivo para .xlsx ou .csv.')
  }

  if (extension === 'csv') {
    const [{ default: Papa }, text] = await Promise.all([
      import('papaparse'),
      file.text(),
    ])
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => cleanText(header),
    })
    if (parsed.errors?.length) {
      throw new Error(`CSV invalido: ${parsed.errors[0].message}`)
    }
    return parsed.data
  }

  if (extension !== 'xlsx') {
    throw new Error('Formato nao suportado. Envie um arquivo .xlsx ou .csv.')
  }

  const { readSheet } = await import('read-excel-file/universal')
  const matrix = await readSheet(file)
  const [headers = [], ...dataRows] = matrix
  const normalizedHeaders = headers.map((header) => cleanText(header))

  return dataRows
    .filter((row) => row.some((value) => value !== null && cleanText(value) !== ''))
    .map((row) => Object.fromEntries(
      normalizedHeaders.map((header, index) => [header || `coluna_${index + 1}`, row[index] ?? null])
    ))
}

export async function parseLegacyProducts(file) {
  const rows = await parseWorkbook(file)
  const mapped = rows.map(mapProductRow).filter(Boolean)
  return {
    totalRows: rows.length,
    rows: mapped,
    skipped: rows.length - mapped.length,
  }
}

export async function parseLegacyClients(file) {
  const rows = await parseWorkbook(file)
  const mapped = rows.map(mapClientRow).filter(Boolean)
  return {
    totalRows: rows.length,
    rows: mapped,
    skipped: rows.length - mapped.length,
  }
}
