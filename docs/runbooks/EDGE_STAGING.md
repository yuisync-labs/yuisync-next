# Runbook — Edge API staging

## Objetivo

Publicar e reverter exclusivamente `yuisync-edge-api-staging`. Este runbook não autoriza tráfego produtivo, domínio customizado, banco real ou substituição do backend Express.

## Pré-requisitos

- conta Cloudflare exclusiva da organização;
- token de API com privilégio mínimo para Workers Scripts no ambiente de staging;
- `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` disponíveis apenas no cofre do CI ou na sessão local autorizada;
- branch baseada em `architecture/cloudflare-foundation` com CI verde;
- nenhum route pattern ou custom domain configurado no `wrangler.jsonc`.

## Validação antes do deploy

Na raiz do repositório:

```bash
npm ci
```

```bash
npm run edge:check
```

Confirme a identidade Cloudflare:

```bash
npx wrangler whoami --cwd apps/edge-api
```

## Deploy

```bash
npm run deploy:staging --workspace @yuisync/edge-api
```

Registre no PR ou change log:

- SHA implantado;
- horário UTC;
- responsável;
- URL `workers.dev` retornada;
- identificador da versão criada;
- resultado dos smoke tests.

## Smoke tests

Execute na URL retornada pelo Wrangler:

```text
GET /health
GET /ready
GET /rota-inexistente
```

Critérios:

- `/health` responde `200` e `status: ok`;
- `/ready` responde `200` e `status: ready`;
- rota inexistente responde `404` sanitizado;
- todas as respostas possuem `x-request-id`;
- logs estruturados aparecem no painel do Worker;
- nenhum request é encaminhado para Express, Supabase ou outro serviço.

## Rollback

Liste os deployments disponíveis:

```bash
npx wrangler deployments list --env staging --cwd apps/edge-api
```

Reverta para a versão anterior:

```bash
npm run rollback:staging --workspace @yuisync/edge-api
```

Após o rollback, repita os três smoke tests e registre a versão restaurada.

## Condições de interrupção

Interrompa ou reverta quando ocorrer qualquer um destes casos:

- `/health` ou `/ready` fora dos critérios;
- logs sem correlação de requisição;
- erro inesperado ou exposição de detalhe interno;
- criação acidental de rota ou domínio produtivo;
- dependência de secret, banco ou binding não declarada;
- divergência entre tipos gerados e `wrangler.jsonc`.

## Limites desta fase

- sem D1;
- sem Hyperdrive;
- sem R2, KV, Queues, Workflows ou Durable Objects;
- sem autenticação de clientes;
- sem dados reais;
- sem tráfego produtivo.
