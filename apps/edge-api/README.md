# YuiSync Edge API

Fundação isolada do runtime Cloudflare Workers. Este workspace não substitui o backend Express, não acessa dados reais e não contém rotas comerciais.

## Endpoints

- `GET /` — identifica a fundação e informa que nenhuma rota foi migrada;
- `GET /health` — liveness do processo Worker;
- `GET /ready` — valida apenas a configuração local do Worker;
- demais rotas retornam `404` sanitizado.

Todas as respostas incluem `x-request-id`, `cache-control: no-store` e logs estruturados sem body da requisição.

## Ambientes

O `wrangler.jsonc` define:

- `local` para desenvolvimento;
- `test` para execução em `workerd` pela integração do Vitest;
- `staging` para o primeiro deploy controlado.

Não existe ambiente de produção nesta fase.

## Desenvolvimento

Na raiz do repositório:

```bash
npm run edge:types
```

```bash
npm run edge:dev
```

O Worker local fica disponível na porta informada pelo Wrangler.

## Verificações

```bash
npm run edge:check
```

Esse comando confirma:

1. tipos gerados atualizados;
2. typecheck do workspace;
3. testes dentro do runtime Workers;
4. bundle de staging por `wrangler deploy --dry-run`.

## Secrets

Health e readiness não exigem secrets. Quando uma rota futura precisar autenticar um adapter:

1. copie `.dev.vars.example` para `.dev.vars` apenas no ambiente local;
2. use `wrangler secret put <NOME> --env staging` no staging;
3. nunca declare secrets em `vars`, commits, logs ou respostas;
4. documente o owner e a rotação no runbook da rota.

## Deploy e rollback

O deploy de staging não ocorre automaticamente sem credenciais exclusivas da organização. Após configurar o ambiente:

```bash
npm run deploy:staging --workspace @yuisync/edge-api
```

Para reverter para a versão anterior:

```bash
npm run rollback:staging --workspace @yuisync/edge-api
```

Antes do primeiro deploy, consulte `docs/runbooks/EDGE_STAGING.md`.
