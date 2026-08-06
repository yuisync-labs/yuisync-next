# Fase 4 — Fundação de acesso a dados com Cloudflare D1

## Objetivo

Criar a primeira fundação persistente da nova arquitetura usando Cloudflare D1, sem migrar dados do sistema atual, sem substituir rotas do backend legado e sem expor operações de negócio.

Fluxo desta fase:

```text
Cloudflare Worker
  -> port de aplicação independente de provedor
  -> adapter D1 + Drizzle
  -> Cloudflare D1 de staging
```

O código de domínio e aplicação não depende de D1, Wrangler ou Drizzle. Esses detalhes ficam restritos aos adapters, schema e composição do runtime.

## Decisões da fase

- D1 será o banco SQL principal da nova arquitetura.
- A semântica adotada será SQLite/D1, não PostgreSQL.
- Drizzle será a camada de schema e consultas tipadas.
- O binding do Worker será chamado `DB`.
- `EDGE_DATABASE_ENABLED` permanece desligada por padrão em local e test.
- Staging só ativa o banco quando o binding protegido está configurado.
- Durable Objects serão usados futuramente para coordenação concorrente sensível.
- Supabase, Neon, PostgreSQL externo e Hyperdrive não fazem parte desta fase.

## Escopo

### Incluído

- port de acesso a dados independente de provedor;
- adapter D1 para consulta canário;
- Drizzle para schema e consultas tipadas;
- banco D1 exclusivo de staging;
- binding D1 exclusivo do ambiente staging;
- migrations SQL versionadas no repositório;
- testes dentro do runtime Workers;
- timeout lógico e erros sanitizados;
- readiness separado para dependências externas;
- consulta canário sem tabelas de negócio;
- feature flag fail-closed;
- observabilidade sem SQL, parâmetros ou dados pessoais.

### Fora do escopo

- importação do banco legado;
- migração das migrations PostgreSQL existentes;
- rotas de catálogo, agenda, pedidos, clientes ou mensagens;
- escrita de negócio;
- autenticação;
- banco D1 de produção;
- D1 por tenant nesta primeira etapa;
- Durable Objects, R2, Queues ou Workflows nesta PR;
- substituição do backend Express.

## Implementação concluída

1. ADR de D1 aceito;
2. port independente de provedor preservado;
3. adapter e dependências PostgreSQL removidos;
4. adapter D1 implementado e testado;
5. migration inicial mínima e imutável criada;
6. D1 isolado configurado nos testes do `workerd`;
7. banco remoto `yuisync-next-staging` criado;
8. binding `DB` adicionado somente em staging;
9. migration aplicada por workflow protegido;
10. consulta remota de metadata validada;
11. canário D1 composto no `/ready` sob feature flag;
12. rollback de flag e binding ensaiado;
13. binding e flag restaurados e revalidados;
14. deploy futuro tornado consciente de migrations D1.

## Regras de segurança

- database ID não é secret, mas só aparece no ambiente correto;
- tokens Cloudflare permanecem no GitHub Environment;
- nenhuma API aceita SQL vindo da requisição;
- nenhuma consulta operacional registra SQL ou parâmetros em logs;
- nenhuma tabela de negócio foi criada nesta migration;
- migrations aplicadas são imutáveis;
- toda futura tabela multi-tenant terá `tenant_id` obrigatório;
- toda consulta de coleção terá limite explícito;
- índices serão definidos junto dos filtros de tenant e estado;
- erros externos retornam somente código categorizado e correlation ID;
- local e test permanecem com a feature flag desligada por padrão.

## Consulta canário

A consulta é constante:

```sql
SELECT 1 AS canary_value;
```

Ela valida apenas:

- existência do binding;
- disponibilidade do D1;
- execução de consulta;
- timeout lógico;
- resposta sanitizada;
- ausência de SQL e dados em logs.

## Estratégia de migrations

As migrations ficam no workspace Edge:

```text
apps/edge-api/migrations/
  0001_foundation.sql
```

A migration inicial cria somente `_yuisync_system_metadata` e registra `schema_version = 1`.

O workflow **Edge staging deploy** aplica migrations pendentes antes de publicar o Worker e interrompe quando a verificação do metadata falha. Produção não foi criada nesta fase.

## Estratégia multi-tenant

A primeira versão usará banco compartilhado. O design permite evolução posterior:

```text
tenant router
  -> D1 compartilhado por grupo
  -> shard por faixa de tenant
  -> D1 dedicado para tenant grande
```

Nenhum caso de uso poderá depender diretamente de um único banco físico.

## Concorrência

Operações como reserva de agenda e confirmação pendente não dependerão apenas da serialização do D1. A coordenação será implementada com Durable Objects antes da ativação dessas escritas no runtime novo.

## Resultado operacional de staging

```text
Database: yuisync-next-staging
Region hint: ENAM
Worker binding: DB
Migration: 0001_foundation.sql
Schema version: 1
Feature flag de staging: true
Readiness final: database = ready
```

O ensaio operacional comprovou:

```text
D1 ativo
  -> /ready = ready / database = ready

binding removido + flag desligada
  -> /ready = ready / database = disabled

binding restaurado + flag ligada
  -> /ready = ready / database = ready
```

O banco e as migrations permaneceram intactos durante o rollback de aplicação.

## Gates obrigatórios

- [x] decisão D1 registrada;
- [x] port independente de provedor;
- [x] feature flag fail-closed;
- [x] adapter canário D1 criado;
- [x] dependências PostgreSQL removidas;
- [x] migration inicial criada;
- [x] D1 local/test configurado;
- [x] testes D1 no runtime Workers verdes;
- [x] banco D1 de staging criado;
- [x] binding `DB` de staging configurado;
- [x] migration aplicada em staging;
- [x] consulta canário ao vivo aprovada;
- [x] indisponibilidade e ausência de binding testadas;
- [x] logs sanitizados por contrato e smoke operacional;
- [x] rollback da flag e do binding ensaiado;
- [x] restauração do D1 revalidada;
- [x] nenhuma regressão no legado;
- [ ] CI final do commit documental e operacional.

## Rollback

O rollback lógico consiste em definir `EDGE_DATABASE_ENABLED=false` e remover o binding `DB` da versão publicada do Worker.

O `/ready` continua saudável com `database = disabled`, enquanto o banco e suas migrations permanecem intactos. Para restaurar, recoloca-se o binding, ativa-se a flag e confirma-se `database = ready`.

Uma migration aplicada não deve ser editada. Correções são feitas por nova migration. Recuperações excepcionais devem seguir o runbook e a estratégia de Time Travel do D1.

## Runbooks

- `docs/runbooks/EDGE_STAGING.md`;
- `docs/runbooks/D1_STAGING.md`.

## Critério de saída

A fase termina quando a CI final estiver verde no SHA exato da PR, após comprovar binding, migration, canário, observabilidade e rollback de aplicação em staging, sem expor rota de negócio nem alterar o comportamento do sistema atual.
