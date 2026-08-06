# Architecture Decision Records

Este diretório registra decisões arquiteturais relevantes do YuiSync.

## Índice

- `0000-template.md` — modelo para novos ADRs;
- `0001-cloudflare-first-modular-monolith.md` — adoção de Cloudflare-first com monólito modular;
- `0002-postgresql-neon-hyperdrive.md` — PostgreSQL independente no Neon via Hyperdrive.

## Estados

- `proposed`: decisão em discussão;
- `accepted`: decisão aprovada e vigente;
- `superseded`: substituída por outro ADR;
- `deprecated`: não deve ser usada em novas implementações.

## Regras

- ADRs aceitos não são reescritos para alterar a decisão histórica;
- mudanças relevantes exigem um novo ADR que referencia o anterior;
- SDKs e provedores não devem atravessar os limites definidos pelos ports;
- decisões de infraestrutura precisam registrar rollback e impacto operacional.
