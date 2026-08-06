# Architecture Decision Records

Este diretório registra decisões arquiteturais relevantes do YuiSync.

## Índice

- `0000-template.md` — modelo para novos ADRs;
- `0001-cloudflare-first-modular-monolith.md` — adoção de Cloudflare-first com monólito modular;
- `0002-cloudflare-d1-primary-database.md` — D1 como banco principal da nova arquitetura;
- `0003-cloudflare-queues-idempotent-events.md` — Queues, retries, DLQ e processamento idempotente.

## Estados

- `proposed`: decisão em discussão;
- `accepted`: decisão aprovada e vigente;
- `superseded`: substituída por outro ADR;
- `deprecated`: não deve ser usada em novas implementações.

## Regras

- ADRs aceitos não são reescritos para alterar a decisão histórica depois do merge;
- mudanças relevantes exigem um novo ADR que referencia o anterior;
- SDKs e provedores não devem atravessar os limites definidos pelos ports;
- decisões de infraestrutura precisam registrar rollback e impacto operacional.
