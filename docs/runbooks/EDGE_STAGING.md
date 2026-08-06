# Runbook — Edge API staging

## Objetivo

Publicar e reverter exclusivamente `yuisync-edge-api-staging`. Este runbook não autoriza tráfego produtivo, domínio customizado ou substituição do backend Express.

A operação do banco D1 está detalhada em `docs/runbooks/D1_STAGING.md`.

## Pré-requisitos

- conta Cloudflare exclusiva da organização;
- token de API com privilégios mínimos para Workers Scripts e D1 no staging;
- GitHub Environment `cloudflare-staging`, preferencialmente com aprovação obrigatória;
- secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` armazenados no Environment;
- branch baseada em `architecture/cloudflare-foundation` com CI verde;
- nenhum route pattern ou custom domain produtivo configurado no `wrangler.jsonc`.

O token não deve ser salvo em arquivo, variável não secreta, log, comentário ou commit.

## Validação antes do deploy

Na raiz do repositório:

```bash
npm ci
```

```bash
npm run edge:check
```

Confirme que o `wrangler.jsonc` de staging aponta apenas para:

```text
Worker: yuisync-edge-api-staging
D1: yuisync-next-staging
Binding: DB
```

## Deploy protegido pelo GitHub

O workflow **Edge staging deploy** pode ser iniciado pela label `architecture` em uma PR válida da própria organização, com base `architecture/cloudflare-foundation` e branch `phase/*`.

O workflow:

1. exige os dois secrets Cloudflare;
2. executa `npm ci` e `npm run edge:check`;
3. aplica migrations pendentes no D1 de staging;
4. verifica o metadata de fundação do banco;
5. publica o Worker com `cloudflare/wrangler-action`;
6. executa smoke tests automatizados;
7. confirma `checks.database = ready`;
8. registra SHA, URL e resultado no resumo da execução.

O deploy local equivalente, após aplicar migrations, é:

```bash
npm run deploy:staging --workspace @yuisync/edge-api
```

## Smoke tests

O comando automatizado é:

```bash
npm run edge:smoke -- https://URL-DE-STAGING
```

Ele valida:

- `/health` com `200`, ambiente `staging` e `status: ok`;
- `/ready` com `200` e `status: ready`;
- rota inexistente com `404` sanitizado;
- propagação de `x-request-id`;
- `cache-control: no-store`.

O workflow também confirma separadamente que o readiness contém:

```text
checks.database = ready
```

Após a automação, confirme que os logs estruturados aparecem no painel do Worker e não contêm SQL, parâmetros, tokens ou dados pessoais.

## Rollback de versão do Worker

Liste os deployments e identifique a versão estável:

```bash
npx wrangler deployments list --env staging --cwd apps/edge-api
```

No GitHub:

1. abra **Actions**;
2. selecione **Edge staging rollback**;
3. informe o version ID estável;
4. informe a URL HTTPS de staging;
5. digite `ROLLBACK` no campo de confirmação;
6. aprove o GitHub Environment.

O workflow executa o rollback de versão e repete os smoke tests.

## Rollback da dependência D1

Quando o problema estiver apenas no banco ou no binding, prefira o rollback lógico descrito em `D1_STAGING.md`:

```text
EDGE_DATABASE_ENABLED=false
+ remover binding DB
+ publicar Worker
+ confirmar database: disabled
```

O banco e as migrations permanecem intactos. Depois da correção, restaure binding e flag e confirme `database: ready`.

## Registro obrigatório

Para deploy e rollback, registre:

- SHA do código;
- horário UTC;
- responsável e aprovador;
- URL `workers.dev`;
- version ID implantado ou restaurado;
- estado das migrations D1;
- resultado dos smoke tests;
- confirmação visual dos Workers Logs.

## Condições de interrupção

Interrompa ou reverta quando ocorrer qualquer um destes casos:

- `/health` ou `/ready` fora dos critérios;
- `checks.database` diferente de `ready` com a flag ativa;
- logs sem correlação de requisição;
- erro inesperado ou exposição de detalhe interno;
- criação acidental de rota ou domínio produtivo;
- binding apontando para banco incorreto;
- divergência entre tipos gerados e `wrangler.jsonc`;
- migration remota diferente do commit aprovado.

## Limites atuais

- sem tráfego produtivo;
- sem autenticação de clientes no runtime novo;
- sem importação de dados legados;
- sem tabelas de negócio no D1;
- sem R2, KV, Queues, Workflows ou Durable Objects nesta fase.
