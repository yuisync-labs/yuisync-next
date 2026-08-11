# Fiscal foundation — MG / Muriaé — baseline 2026-08

## Status

**Production transmission is intentionally disabled.** This foundation only prepares homologation, tenant isolation, fiscal profiles, item rules, document intents and audit events.

Current target architecture:

- services for ME/EPP Simples: NFS-e Nacional / SEFIN;
- retail goods in Minas Gerais: NFC-e model 65 / SEF-MG;
- NF-e model 55: supported as a provider/document contract for operations that require it;
- mixed sale: one YuiSync sale may create more than one fiscal document;
- fiscal processing stays decoupled from checkout so fiscal outages cannot roll back an already committed operational sale.

## Safety invariants

1. `fiscal_profiles.environment` and `fiscal_documents.environment` accept only `homologation` in schema v23.
2. Provider adapters contain no outbound transport and `transmit()` always fails with `FISCAL_TRANSPORT_DISABLED`.
3. Raw PFX/P12/private key/password/CSC tokens are rejected by the API. D1 stores only secret references and certificate metadata.
4. CNPJ is stored as `TEXT`; validation is compatible with the 2026 alphanumeric shape and does not apply the legacy digits-only checksum to alphanumeric registrations.
5. Fiscal tax rules are versioned per catalog item and effective date. NCM/CFOP/CSOSN/CST/service/NBS/IBS-CBS fields are configuration, never guessed in JSX or checkout code.

## Credentials / external approvals still required per tenant

- CNPJ and company fiscal registration data;
- SEF-MG accreditation for NFC-e/NF-e as applicable;
- NFC-e CSC ID + CSC stored in a secure secret store/reference;
- ICP-Brasil certificate provisioned through a secure certificate/secret binding, not D1 plaintext;
- municipal registration and NFS-e Nacional readiness for services;
- accountant-approved fiscal item rules and tax regime parameters;
- successful homologation/certification tests against official environments;
- a separate explicit production-enablement change and authorization.

## Native API prepared

- `GET /api/fiscal/profile`
- `PUT /api/fiscal/profile`
- `GET /api/fiscal/readiness`
- `POST /api/fiscal/sales/:saleId/issue`
- `GET /api/fiscal/sales/:saleId/documents`

The issue endpoint currently prepares idempotent fiscal documents and readiness blockers only. It does not transmit anything.

## Revalidation gate

Official layouts, technical notes, endpoints and tax parameters must be revalidated immediately before enabling real homologation transport and again before any production enablement. This document records the implementation baseline, not a permanent legal rulebook.
