import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function channel(value) {
  const n = value / 255
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
}
function luminance(hex) {
  const raw = hex.replace('#', '')
  const rgb = [0, 2, 4].map((index) => Number.parseInt(raw.slice(index, index + 2), 16))
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (high + 0.05) / (low + 0.05)
}

test('META-06 tokens de texto principal e secundário passam contraste AA em light e dark', () => {
  const pairs = [
    ['#0F172A', '#FFFFFF'],
    ['#475569', '#FFFFFF'],
    ['#F8FAFC', '#0D1424'],
    ['#A9B8CE', '#0D1424'],
  ]
  for (const [foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} / ${background} abaixo de AA`)
  }
})

test('META-06 página Meta usa tokens semânticos que trocam com tema', async () => {
  const page = await read('src/shared/pages/MetaWhatsappPage.jsx')
  const css = await read('src/index.css')

  assert.match(page, /border-\[var\(--border2\)\]/)
  assert.match(page, /bg-surface/)
  assert.match(page, /bg-bg/)
  assert.match(page, /text-text/)
  assert.match(page, /text-muted/)
  assert.match(page, /className="input w-full"/)

  assert.match(css, /\.theme-petshop\s*\{[\s\S]*--surface:\s*#FFFFFF;[\s\S]*--text:\s*#0F172A;[\s\S]*--muted:\s*#475569;/)
  assert.match(css, /\.theme-petshop\.theme-dark\s*\{[\s\S]*--surface:\s*#0D1424;[\s\S]*--text:\s*#F8FAFC;[\s\S]*--muted:\s*#A9B8CE;/)
})

test('META-06 campos Meta não forçam texto preto/branco incompatível com troca de tema', async () => {
  const page = await read('src/shared/pages/MetaWhatsappPage.jsx')
  const formStart = page.indexOf('title="Send a WhatsApp message"')
  const formEnd = page.indexOf('Notes for the Meta reviewer')
  const forms = page.slice(formStart, formEnd)
  assert.ok(formStart >= 0 && formEnd > formStart)
  assert.doesNotMatch(forms, /text-black|bg-black|bg-white\b|text-white\b/)
  assert.match(forms, /className="input/)
  assert.match(forms, /text-text|text-muted/)
})
