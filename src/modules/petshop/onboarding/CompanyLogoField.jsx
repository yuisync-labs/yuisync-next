import { useMemo, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_DATA_URL_LENGTH = 190_000

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('O arquivo selecionado não é uma imagem válida.'))
    image.src = source
  })
}

async function prepareCompanyLogo(file) {
  if (!ACCEPTED_TYPES.has(file?.type)) throw new Error('Use uma imagem PNG, JPG ou WEBP.')
  if (file.size > MAX_FILE_BYTES) throw new Error('A imagem deve ter no máximo 5 MB.')

  const source = await readFile(file)
  const image = await loadImage(source)
  const side = 320
  const scale = Math.min(1, side / image.width, side / image.height)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O navegador não conseguiu preparar a imagem.')
  context.drawImage(image, 0, 0, width, height)

  let quality = 0.9
  let result = canvas.toDataURL('image/webp', quality)
  while (result.length > MAX_DATA_URL_LENGTH && quality > 0.5) {
    quality -= 0.1
    result = canvas.toDataURL('image/webp', quality)
  }
  if (result.length > MAX_DATA_URL_LENGTH) throw new Error('A imagem ficou muito grande. Escolha uma versão mais simples.')
  return result
}

function initials(name) {
  return String(name || 'Y')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'Y'
}

export function CompanyLogoField({ name, value, disabled, onChange }) {
  const inputRef = useRef(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const fallback = useMemo(() => initials(name), [name])

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProcessing(true)
    setError('')
    try {
      onChange(await prepareCompanyLogo(file))
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível preparar a imagem.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <span className="inp-label">Logo ou avatar</span>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[var(--border2)] bg-[var(--surface)] text-xl font-black text-text">
          {value ? <img src={value} alt="Prévia da logo da empresa" className="h-full w-full object-cover" /> : fallback}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
          <button type="button" className="btn btn-secondary" disabled={disabled || processing} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={15} /> {processing ? 'Preparando…' : value ? 'Trocar imagem' : 'Enviar imagem'}
          </button>
          {value && <button type="button" className="btn btn-ghost" disabled={disabled || processing} onClick={() => onChange('')}><Trash2 size={15} /> Remover</button>}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">PNG, JPG ou WEBP. Sem imagem, usamos as iniciais da empresa.</p>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-[var(--ui-danger-fg)]">{error}</p>}
    </div>
  )
}

