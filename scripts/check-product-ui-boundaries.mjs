#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const baseRef = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : 'origin/main'

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

let diff = ''
try {
  diff = git(['diff', '--unified=0', '--no-ext-diff', `${baseRef}...HEAD`, '--', 'src'])
} catch (error) {
  console.warn(`Product UI boundary check skipped: cannot diff against ${baseRef}.`)
  process.exit(0)
}

const violations = []
let currentFile = ''
let currentHunk = []

function inspectHunk() {
  if (!currentFile || currentHunk.length === 0) return
  if (!currentFile.endsWith('.jsx')) return
  if (currentFile.startsWith('src/public/')) return
  if (currentFile.startsWith('src/components/ui/')) return

  const added = currentHunk.join('\n')
  const rawCardRecipe = /(?:bg-card[\s\S]{0,260}(?:border[\s\S]{0,180}rounded|rounded[\s\S]{0,180}border)|border[\s\S]{0,260}(?:bg-card[\s\S]{0,180}rounded|rounded[\s\S]{0,180}bg-card)|rounded[\s\S]{0,260}(?:bg-card[\s\S]{0,180}border|border[\s\S]{0,180}bg-card))/

  if (rawCardRecipe.test(added)) {
    violations.push(currentFile)
  }
}

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    inspectHunk()
    currentFile = line.slice('+++ b/'.length)
    currentHunk = []
    continue
  }
  if (line.startsWith('@@')) {
    inspectHunk()
    currentHunk = []
    continue
  }
  if (line.startsWith('+') && !line.startsWith('+++')) {
    currentHunk.push(line.slice(1))
  }
}
inspectHunk()

const uniqueViolations = [...new Set(violations)].sort()
if (uniqueViolations.length > 0) {
  console.error('New page-local card recipes are not allowed. Use src/components/ui primitives instead:')
  for (const file of uniqueViolations) console.error(`- ${file}`)
  process.exit(1)
}

console.log('Product UI boundaries preserved: no new raw card recipes outside src/components/ui.')
