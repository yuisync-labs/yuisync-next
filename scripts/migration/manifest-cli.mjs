#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  MigrationManifestError,
  buildMigrationManifest,
  reconcileMigrationManifests,
} from './manifest.mjs'

function usage() {
  return [
    'YuiSync migration manifest foundation',
    '',
    'Build a deterministic manifest from a local snapshot JSON:',
    '  node scripts/migration/manifest-cli.mjs build --input snapshot.json [--output manifest.json]',
    '',
    'Compare two manifests:',
    '  node scripts/migration/manifest-cli.mjs reconcile --source source.manifest.json --destination destination.manifest.json [--output report.json]',
    '',
    'This tool never connects to Supabase, D1, or any network service and has no apply mode.',
  ].join('\n')
}

function parseArgs(argv) {
  const [command, ...tokens] = argv
  const options = {}

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) {
      throw new MigrationManifestError('INVALID_CLI_ARGUMENT', `Unexpected argument: ${token}`)
    }
    const name = token.slice(2)
    const value = tokens[index + 1]
    if (!value || value.startsWith('--')) {
      throw new MigrationManifestError('INVALID_CLI_ARGUMENT', `Missing value for --${name}.`)
    }
    if (Object.hasOwn(options, name)) {
      throw new MigrationManifestError('INVALID_CLI_ARGUMENT', `Duplicate option: --${name}.`)
    }
    options[name] = value
    index += 1
  }

  return { command, options }
}

async function readJson(pathValue) {
  const filePath = resolve(pathValue)
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    throw new MigrationManifestError('INPUT_READ_FAILED', `Could not read input file: ${filePath}`)
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new MigrationManifestError('INPUT_JSON_INVALID', `Input file is not valid JSON: ${filePath}`)
  }
}

async function emitJson(value, outputPath) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (!outputPath) {
    process.stdout.write(serialized)
    return
  }
  await writeFile(resolve(outputPath), serialized, { encoding: 'utf8', flag: 'wx' })
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))

  if (command === 'build') {
    if (!options.input) throw new MigrationManifestError('INPUT_REQUIRED', '--input is required.')
    const snapshot = await readJson(options.input)
    const manifest = buildMigrationManifest(snapshot)
    await emitJson(manifest, options.output)
    return
  }

  if (command === 'reconcile') {
    if (!options.source || !options.destination) {
      throw new MigrationManifestError(
        'MANIFESTS_REQUIRED',
        '--source and --destination are required.',
      )
    }
    const source = await readJson(options.source)
    const destination = await readJson(options.destination)
    const report = reconcileMigrationManifests(source, destination)
    await emitJson(report, options.output)
    process.exitCode = report.in_sync ? 0 : 2
    return
  }

  throw new MigrationManifestError('UNKNOWN_COMMAND', usage())
}

main().catch((error) => {
  if (error instanceof MigrationManifestError) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
    process.exitCode = 1
    return
  }
  process.stderr.write('UNEXPECTED_ERROR: migration manifest command failed.\n')
  process.exitCode = 1
})
