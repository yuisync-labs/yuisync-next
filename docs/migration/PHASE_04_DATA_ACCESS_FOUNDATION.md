# Fase 4 — Fundação de acesso a dados com Cloudflare D1

## Objetivo

Criar a primeira fundação persistente da nova arquitetura usando Cloudflare D1, sem migrar dados do sistema atual, sem substituir rotas do backend legado e sem expor operações de negócio.

Fluxo-alvo desta fase:

```text
Cloudflare Worker
  -> port de aplicação independente de provedor
  -> adapter D1 + Drizzle
  -> Cloudflare D1 de staging
```

O código de domínio e aplicação não poderá depender de D1, Wrangler ou Drizzle. Esses detalhes ficam restritos aos adapters, schema e composição do runtime.

## Decisões da fase

- D1 será o banco SQL principal da nova arquitetura.
- A semântica de banco adotada será SQLite/D1, não PostgreSQL.
- Drizzle continuará como camada de schema e consultas tipadas.
- O binding do Worker será chamado `DB`.
- A feature flag `EDGE_DATABASE_ENABLED` continuará desligada por padrão.
- Durable Objects serão usados futuramente para coordenação concorrente sensível.
- Supabase, Neon e Hyperdrive não fazem parte desta fase.

## Escopo

### Incluído

- port de acesso a dados independente de provedor;
- adapter D1 para consulta canário;
- Drizzle para schema e consultas tipadas;
- banco D1 exclusivo de staging;
- binding D1 exclusivo do ambiente staging;
- migrations SQL versionadas no repositório;
- testes locais dentro do runtime Workers;
- timeout lógico e erros sanitizados;
- readiness separado para dependências externas;
- consulta canário sem tabelas de negócio;
- feature flag desligada por padrão;
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

## Ordem de implementação

1. aceitar o ADR de D1 como banco principal;
2. preservar o port independente de provedor;
3. remover o adapter e as dependências PostgreSQL;
4. implementar adapter D1 testável sem binding remoto;
5. manter `EDGE_DATABASE_ENABLED=false` em todos os ambientes;
6. criar migration inicial mínima e imutável;
7. configurar D1 local/test no runtime Workers;
8. validar migrations e consultas no `workerd`;
9. criar o banco remoto `yuisync-next-staging`;
10. adicionar o binding `DB` somente em staging;
11. aplicar migrations por workflow protegido;
12. executar consulta canário ao vivo;
13. validar timeout, indisponibilidade e logs;
14. ensaiar rollback desligando a flag e restaurando o Worker sem dependência ativa;
15. integrar somente após todos os gates.

## Regras de segurança

- nenhum ID de banco precisa ser tratado como secret, mas deve ser versionado somente no ambiente correto;
- tokens Cloudflare permanecem no GitHub Environment;
- nenhuma API aceita SQL vindo da requisição;
- nenhuma consulta operacional registra SQL ou parâmetros em logs;
- nenhuma tabela de negócio é criada nesta primeira migration;
- migrations aplicadas são imutáveis;
- toda futura tabela multi-tenant terá `tenant_id` obrigatório;
- toda consulta de coleção terá limite explícito;
- índices serão definidos junto dos filtros de tenant e estado;
- erros externos retornam somente código categorizado e correlation ID;
- a feature flag permanece desligada até o teste protegido.

## Consulta canário

A primeira consulta será constante:

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

As migrations serão armazenadas dentro do workspace Edge e aplicadas pelo Wrangler:

```text
apps/edge-api/migrations/
  0001_foundation.sql
```

O banco de staging só receberá migrations por workflow protegido. Produção não será criada nesta fase.

## Estratégia multi-tenant

A primeira versão usará um banco compartilhado. O design deverá permitir evolução posterior:

```text
tenant router
  -> D1 compartilhado por grupo
  -> shard por faixa de tenant
  -> D1 dedicado para tenant grande
```

Nenhum caso de uso poderá depender diretamente de um único banco físico.

## Concorrência

Operações como reserva de agenda e confirmação pendente não dependerão apenas da serialização do D1. A coordenação será implementada com Durable Objects antes da ativação dessas escritas no runtime novo.

## Gates obrigatórios

- [x] decisão D1 registrada;
- [x] port independente de provedor;
- [x] feature flag desligada por padrão;
- [x] adapter canário D1 criado;
- [ ] dependências PostgreSQL removidas;
- [ ] migration inicial criada;
- [ ] D1 local/test configurado;
- [ ] testes D1 no runtime Workers verdes;
- [ ] banco D1 de staging criado;
- [ ] binding `DB` de staging configurado;
- [ ] migrations aplicadas em staging;
- [ ] consulta canário ao vivo aprovada;
- [ ] timeout e indisponibilidade ao vivo testados;
- [ ] logs sanitizados no staging;
- [ ] rollback da flag/binding ensaiado;
- [ ] nenhuma regressão no legado.

## Rollback

O rollback lógico consiste em manter ou restaurar `EDGE_DATABASE_ENABLED=false`.

O rollback do runtime consiste em publicar uma versão do Worker que não exige o binding para readiness. Como a fase não permite escrita de negócio nem importação de dados, não existe rollback de dados do sistema atual.

O banco D1 de staging poderá ser restaurado por Time Travel se uma migration experimental causar problema, mas migrations incorretas devem ser corrigidas por nova migration, nunca alterando uma migration já aplicada.

## Critério de saída

A fase termina quando o Worker consegue validar, sob feature flag e em staging, uma conexão com D1 por binding nativo, com migrations, testes no `workerd`, observabilidade, timeout e rollback comprovados, sem expor rota de negócio nem alterar o comportamento do sistema atual.
