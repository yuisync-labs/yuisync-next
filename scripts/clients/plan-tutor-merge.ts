// Plans the duplicate-tutor merge from JSON dumps and writes one SQL file per step.
// Usage (from the repo root):
//   npx esbuild scripts/clients/plan-tutor-merge.ts --bundle --platform=node --format=esm --outfile=/tmp/plan.mjs
//   node /tmp/plan.mjs <dump dir> <out dir> <tenant id> <batch id>
// The dump dir holds clients.json, pets.json and history.json ({client_id: count}),
// read from D1. The SQL holds customer data: keep it out of the repository.
import fs from 'node:fs'
import path from 'node:path'
import { planTutorMerge, tutorMergeSql } from '../../apps/edge-api/src/clientMerge'

const [dumps, out, tenantId, batchId] = process.argv.slice(2)
if (!dumps || !out || !tenantId || !batchId) throw new Error('usage: plan-tutor-merge <dump dir> <out dir> <tenant id> <batch id>')
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dumps, name), 'utf8'))
const plan = planTutorMerge(read('clients.json'), read('pets.json'), read('history.json'))
const steps = tutorMergeSql(plan, { tenantId, moduleId: 'petshop', batchId, now: Date.now() })
fs.mkdirSync(out, { recursive: true })
steps.forEach((s, i) => fs.writeFileSync(path.join(out, `${String(i).padStart(3, '0')}-${s.step.replace(/\W+/g, '-')}.sql`), s.sql))
fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 1))
console.log(JSON.stringify({ merged: plan.merged.length, tutors: new Set(plan.merged.map(m => m.into)).size, filled: plan.kept.length,
  placeholderPets: plan.placeholderPets.length, normalized: plan.normalized.length, conflicts: plan.conflicts.length, files: steps.length }))
