# Architecture Decision Records

ADRs document decisions that materially affect architecture, runtime, data, security, operations or vendor coupling.

## Statuses

- `proposed`: under review;
- `accepted`: approved for implementation;
- `superseded`: replaced by another ADR;
- `rejected`: considered and not selected;
- `deprecated`: retained for history but no longer recommended.

## Numbering

Use four digits and a short slug:

```text
0001-cloudflare-first-modular-monolith.md
0002-contract-validation-with-zod.md
```

Numbers are never reused.

## ADR required for

- adding or replacing a foundational library;
- selecting a Cloudflare service for a domain responsibility;
- changing persistence or authentication strategy;
- introducing dual-write or event-driven behavior;
- changing a public/internal contract incompatibly;
- creating an exception to domain dependency rules;
- accepting a high or critical risk.

## ADR not required for

- isolated bug fixes that preserve contracts;
- test additions;
- documentation corrections;
- routine dependency patches without architectural impact.

## Review requirements

An ADR must identify:

- context and problem;
- constraints;
- options considered;
- decision;
- positive and negative consequences;
- security and tenant impact;
- migration and rollback;
- validation evidence;
- related risks and PRs.

Use [`0000-template.md`](./0000-template.md) as the base.
