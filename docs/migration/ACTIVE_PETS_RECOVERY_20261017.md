# Active pets recovery — 2026-10-17

The earlier client/pet ID audit did not cover active pet records stored in legacy
`clients.details`. Those tutors existed in Next but were excluded from the
client screen's active tutor/pet join.

The recovery reused the existing migration helpers and read only clients and
pets. Starting with 3,075 active Next tutors without an active pet, the scoped
legacy comparison identified 755 active tutors with pet details. The planner
preserved one independently verified recent registration, using matching owner
identity and pet name; names alone were insufficient to merge records.

Production result: **1,005 active pets inserted for 754 existing tutors**. The
post-write comparison checked every migrated pet field, its parent and active
status, with **zero mismatches**. Inserts consumed 4,055 D1 rows read; verification
consumed 3,015. These figures exclude earlier discovery and preflight reads.
No tutor rows or other operational tables were changed by the recovery.

Plan hash: `4928288f91b3a1dc5ec7b7cc37a02d7d385dac9670076d87f4520d4838e43780`.
Private snapshots, the pre-write bookmark and per-batch write receipts remain in
the ignored migration checkpoint directory and must never be committed.

`activePetsRecovery.mjs` provides deterministic IDs, frozen-plan hashing,
idempotent inserts and guards for concurrent tutor edits or newly added pets,
including inactive pets. JSON rows drive complete primary-key lookups; the
explicit join order prevents a tutor-wide scan for every batch.

The client screen also previously loaded only the first 1,000 pets. Its complete
load now follows indexed ID cursors, sorts the resulting list for display, and
fails visibly to the caller on an incomplete page. Quick appointment searches
retain their single-page result limit. No full-table count or OFFSET scan is
required.

Validation covers multi-pet recovery, atomic failure, concurrent edits, inactive
records, safe replay, cursor boundaries, equal pet names, loading past 1,000
records and interruption without returning a partial list as complete.
