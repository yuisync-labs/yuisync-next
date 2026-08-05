# Runbook — Edge API staging

## Objetivo

Publicar e reverter exclusivamente `yuisync-edge-api-staging`. Este runbook não autoriza tráfego produtivo, domínio customizado, banco real ou substituição do backend Express.

## Pré-requisitos

- conta Cloudflare exclusiva da organização;
- token de API com privilégio mínimo para Workers Scripts no ambiente de staging;
- GitHub Environment `cloudflare-staging`, preferencialmente com aprovação obrigatória;
- secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` armazenados no Environment ou cofre da organização;
- branch baseada em `architecture/cloudflare-foundation` com CI verde;
- nenhum route pattern ou custom domain configurado no `wrangler.jsonc`.

O token não deve ser salvo em arquivo, variável não secreta, log, comentário ou commit.

## Validação antes do deploy

Na raiz do repositório:

```bash
npm ci
```

```bash
npm run edge:check
```

Confirme a identidade Cloudflare em uma sessão local autorizada:

```bash
npx wrangler whoami --cwd apps/edge-api
```

## Deploy protegido pelo GitHub

1. abra **Actions**;
2. selecione **Edge staging deploy**;
3. escolha **Run workflow** na branch aprovada;
4. aprove o GitHub Environment quando solicitado.

O workflow:

1. exige os dois secrets Cloudflare;
2. executa `npm ci` e `npm run edge:check`;
3. usa a ação oficial `cloudflare/wrangler-action`;
4. executa `wrangler deploy --env staging`;
5. obtém a URL implantada;
6. executa smoke tests automatizados;
7. registra SHA, URL e resultado no resumo da execução.

O deploy local equivalente é:

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

Após a automação, confirme também que os logs estruturados aparecem no painel do Worker e que nenhum request é encaminhado para Express, Supabase ou outro serviço.

## Rollback protegido pelo GitHub

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

O workflow valida os inputs, executa `wrangler rollback <VERSION_ID> --env staging --message ...` sem prompt interativo e repete os smoke tests.

O rollback local para a versão anterior continua disponível:

```bash
npm run rollback:staging --workspace @yuisync/edge-api
```

## Registro obrigatório

Para deploy e rollback, registre:

- SHA do código;
- horário UTC;
- responsável e aprovador;
- URL `workers.dev`;
- version ID implantado ou restaurado;
- resultado dos smoke tests;
- confirmação visual dos Workers Logs.

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
