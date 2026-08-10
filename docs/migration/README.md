# YuiSync Next — Migration Program

This directory is the control plane for the YuiSync modernization and Cloudflare migration.

## Baseline

- Source commit: `e4c2cd063f83318d4828549fd23f8d6888c7f4e6`
- Safety tag: `baseline-yuisync-e4c2cd0`
- Integration branch: `architecture/cloudflare-foundation`
- PR0 branch: `phase/00-inventory`

## PR0 scope

PR0 is documentation-only. It does not install libraries, change runtime behavior, alter database schemas, modify environment variables, or deploy Cloudflare resources.

Its purpose is to establish:

1. a reproducible baseline;
2. explicit domain boundaries;
3. the target architecture;
4. a phased migration plan;
5. a living risk register;
6. an ADR process for architectural decisions.

## Documents

- [`BASELINE.md`](./BASELINE.md): current system inventory and invariants.
- [`DOMAIN_MAP.md`](./DOMAIN_MAP.md): business domains and ownership boundaries.
- [`ARCHITECTURE_TARGET.md`](./ARCHITECTURE_TARGET.md): intended modular and Cloudflare-first architecture.
- [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md): ordered implementation phases, gates and rollback rules.
- [`RISK_REGISTER.md`](./RISK_REGISTER.md): migration risks, mitigations and triggers.
- [`../adr/README.md`](../adr/README.md): architectural decision record process.

## Non-negotiable rules

- No big-bang rewrite.
- Runtime first; integrations second; database last.
- Every behavior-changing PR requires tests and rollback instructions.
- Domain code must not import vendor SDKs or Cloudflare bindings directly.
- Product orders and service bookings remain separate contracts and flows.
- LLMs interpret language; deterministic application logic owns state transitions and side effects.
- Queued and webhook operations must be idempotent.
- The current YuiSync repository and the baseline tag are never modified by this program.

## Pull request flow

```text
main
└── architecture/cloudflare-foundation
    ├── phase/00-inventory
    ├── phase/01-safety-net
    ├── phase/02-domain-boundaries
    ├── phase/03-cloudflare-foundation
    └── subsequent phase branches
```

Each phase is merged into `architecture/cloudflare-foundation`. The integration branch only reaches `main` after the complete test environment passes the final cutover gates.
