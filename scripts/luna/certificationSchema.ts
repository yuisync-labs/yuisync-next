import {CERTIFICATION_LEDGER_SCHEMA} from './certificationLedger'
export const CERTIFICATION_SCHEMA=[CERTIFICATION_LEDGER_SCHEMA,
 `CREATE TABLE IF NOT EXISTS luna_cert_store(round_id TEXT PRIMARY KEY,version INTEGER NOT NULL,checkpoint_json TEXT NOT NULL) STRICT`,
 `CREATE TABLE IF NOT EXISTS luna_cert_turns(idempotency_key TEXT PRIMARY KEY,round_id TEXT NOT NULL,scenario_id INTEGER NOT NULL,turn_id INTEGER NOT NULL,status TEXT NOT NULL,evidence_json TEXT,created_at_ms INTEGER NOT NULL) STRICT`,
 `CREATE UNIQUE INDEX IF NOT EXISTS luna_cert_one_active ON luna_cert_turns(round_id) WHERE status='running'`,
 `CREATE TABLE IF NOT EXISTS luna_cert_identity(id INTEGER PRIMARY KEY CHECK(id=1),database_id TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment='isolated-luna-v2')) STRICT`,
]
