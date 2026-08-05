# Fase 3 — Fundação Cloudflare

## Objetivo

Criar um runtime Workers reproduzível, observável e testado, sem migrar rotas produtivas nem conectar dados reais.

## Escopo

1. adicionar `apps/edge-api` como workspace isolado;
2. usar Hono sobre ES Modules no runtime Workers;
3. configurar Wrangler para `local`, `test` e `staging`;
4. gerar os tipos de bindings a partir do `wrangler.jsonc`;
5. adicionar correlação de requisição e logs estruturados;
6. implementar apenas liveness, readiness e respostas sanitizadas;
7. testar o Worker dentro do `workerd`;
8. validar o bundle de staging por dry-run;
9. documentar deploy, smoke test e rollback.

## Restrições

- Express e Vercel permanecem ativos;
- nenhuma rota comercial é migrada;
- nenhuma conexão com Supabase ou PostgreSQL;
- nenhum D1 como banco central;
- nenhum binding de storage, fila, workflow ou Durable Object;
- nenhum dado ou secret real no repositório;
- nenhum domínio ou route pattern produtivo;
- nenhum deploy automático antes de credenciais exclusivas de staging.

## Estrutura

```text
apps/edge-api/
  src/
    app.ts
    index.ts
    observability.ts
    requestContext.ts
    types.ts
  test/
    health.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
  wrangler.jsonc
  worker-configuration.d.ts
```

## Endpoints permitidos

- `GET /` — identifica a fundação;
- `GET /health` — liveness sem dependências externas;
- `GET /ready` — valida bindings estáticos do ambiente;
- fallback `404` sanitizado.

Nenhum endpoint lê catálogo, clientes, agenda, pedidos, mensagens ou autenticação.

## Observabilidade

- Workers Logs habilitado por configuração;
- `x-request-id` propagado quando válido ou gerado com `crypto.randomUUID()`;
- logs JSON para início, conclusão e falha;
- duração, método, path, status e ambiente registrados;
- body, headers sensíveis e secrets nunca registrados;
- respostas de erro não expõem stack nem mensagem interna.

## Tipos e ambientes

`wrangler types` gera `worker-configuration.d.ts` com interface `EdgeEnv`. A CI usa `--check` para impedir divergência entre o arquivo gerado e o `wrangler.jsonc`.

Os ambientes possuem os mesmos bindings não sensíveis:

- `APP_ENV`;
- `SERVICE_NAME`;
- `RELEASE_CHANNEL`.

Secrets futuros são configurados em `.dev.vars` no local e pelo comando de secrets no staging. Eles não pertencem a `vars`.

## Gates locais e de CI

```text
npm run edge:types:check
npm run edge:typecheck
npm run edge:test
npm run edge:dry-run
```

O gate `edge:check` executa todos em sequência.

## Gate de saída

- [ ] dependências instaladas e lockfile reproduzível;
- [ ] tipos Wrangler gerados e verificados;
- [ ] typecheck do workspace verde;
- [ ] testes no runtime Workers verdes;
- [ ] bundle de staging gerado por dry-run;
- [ ] observabilidade e correlation ID testados;
- [ ] CI legada permanece verde;
- [ ] runbook de staging e rollback revisado;
- [ ] primeiro deploy de staging executado com credenciais exclusivas;
- [ ] health/readiness e logs validados no staging;
- [ ] rollback por versão ensaiado.

Os três últimos gates permanecem pendentes até a configuração da conta Cloudflare de staging.

## Rollback

Antes do primeiro deploy, reverter a PR remove somente o workspace e os gates locais. Após o primeiro deploy, use `docs/runbooks/EDGE_STAGING.md` para restaurar a versão anterior e depois reverta a PR quando necessário.
