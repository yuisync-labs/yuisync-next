# Runbook — Cloudflare D1 staging

## Objetivo

Operar exclusivamente o banco `yuisync-next-staging`, vinculado ao Worker `yuisync-edge-api-staging` pelo binding `DB`.

Este runbook não autoriza criação de banco produtivo, importação do banco legado, aplicação manual de SQL de negócio ou alteração direta de migrations já aplicadas.

## Recursos

```text
D1 database: yuisync-next-staging
Worker binding: DB
Worker: yuisync-edge-api-staging
Feature flag: EDGE_DATABASE_ENABLED
Migration directory: apps/edge-api/migrations
Migration table: d1_migrations
```

## Segurança

- tokens Cloudflare permanecem no GitHub Environment `cloudflare-staging`;
- nenhuma credencial ou connection string é usada pelo Worker;
- o database ID pode existir no `wrangler.jsonc`, mas nunca deve ser confundido com token;
- SQL vindo de requisições é proibido;
- logs não podem registrar SQL, parâmetros ou dados pessoais;
- produção não deve ser criada nesta fase.

## Desenvolvimento e testes

Os testes usam um D1 isolado no runtime `workerd`. As migrations são aplicadas pelo setup do Vitest.

Na raiz do repositório:

```bash
npm ci
```

```bash
npm run edge:check
```

Os testes devem comprovar:

- aplicação da migration inicial;
- presença de `schema_version = 1`;
- consulta canário pelo binding D1;
- feature flag desligada por padrão;
- falha fechada sem binding;
- erros sanitizados.

## Criação de migration

Crie sempre um arquivo novo e sequencial:

```text
apps/edge-api/migrations/0002_descricao.sql
```

Regras:

- não altere uma migration já aplicada;
- prefira alterações pequenas e reversíveis;
- declare índices junto das consultas que os exigem;
- toda tabela multi-tenant deve possuir `tenant_id` obrigatório;
- nenhuma tabela de negócio deve ser adicionada sem contrato, port e testes da respectiva fase;
- valide primeiro no D1 isolado dos testes.

## Aplicação protegida em staging

O workflow **Edge staging deploy** executa, nesta ordem:

1. `npm ci`;
2. `npm run edge:check`;
3. migrations pendentes no D1 de staging;
4. verificação do metadata de fundação;
5. deploy do Worker;
6. smoke tests HTTP;
7. confirmação de `checks.database = ready`.

O gatilho normal é aplicar a label `architecture` a uma PR da própria organização, cuja base seja `architecture/cloudflare-foundation` e cuja branch comece com `phase/`.

Comandos equivalentes para uma sessão local autorizada:

```bash
cd apps/edge-api
```

```bash
npx wrangler d1 migrations list yuisync-next-staging --env staging --remote
```

```bash
npx wrangler d1 migrations apply yuisync-next-staging --env staging --remote
```

Nunca aplique migrations remotas usando um arquivo diferente do commit aprovado.

## Consulta canário

O readiness usa somente:

```sql
SELECT 1 AS canary_value;
```

Resposta esperada de `/ready` com a feature ativa:

```json
{
  "status": "ready",
  "checks": {
    "database": "ready"
  }
}
```

O payload pode incluir latência, ambiente, timestamp e correlation ID, mas não deve incluir SQL, database ID ou conteúdo de tabelas.

## Rollback de aplicação

O rollback seguro da dependência D1 consiste em:

1. definir `EDGE_DATABASE_ENABLED=false` em staging;
2. remover temporariamente o binding `DB` da configuração do Worker;
3. publicar o Worker;
4. confirmar `/ready` com `checks.database = disabled`;
5. manter o banco e migrations intactos.

Para restaurar:

1. recolocar o binding `DB`;
2. definir `EDGE_DATABASE_ENABLED=true`;
3. publicar novamente;
4. confirmar `/ready` com `checks.database = ready`.

Esse procedimento foi ensaiado na PR4 sem perda de dados.

## Falha de migration

Não edite o arquivo já aplicado. Crie uma migration corretiva nova.

Quando a recuperação lógica não for suficiente, consulte primeiro os bookmarks e a janela de Time Travel do D1 antes de qualquer restauração. Registre o ponto de restauração, impacto e aprovador.

## Observabilidade

Eventos esperados:

```text
edge.database.ready
edge.database.not_ready
edge.request.completed
```

Campos permitidos:

```text
request_id
status
latency_ms
environment
code
```

Campos proibidos:

```text
SQL
parâmetros
headers sensíveis
tokens
dados pessoais
conteúdo de tabelas
```

## Condições de interrupção

Interrompa o deploy quando ocorrer:

- migration não aplicada ou parcialmente aplicada;
- `schema_version` inesperado;
- `/ready` diferente de `200` e `database: ready` após propagação;
- logs expondo detalhes internos;
- binding apontando para banco diferente de `yuisync-next-staging`;
- alteração de migration já aplicada;
- inclusão de tabela multi-tenant sem `tenant_id` e índices planejados.
