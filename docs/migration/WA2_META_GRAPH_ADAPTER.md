# WA2 — Meta WhatsApp Graph Adapter

Status: **implementado em branch, sem cutover**

Data: 2026-08-17

Base: `main` em `a1c51f2304f82dd4dad16650630f59993a394d6f`.

## Objetivo

Isolar o transporte Meta Graph API atrás do `WhatsAppMessagingPort` criado no WA1, sem alterar webhook, bindings, secrets, callback, banco, onboarding ou fluxo produtivo atual.

## Alterações

### Adapter dedicado

Arquivo: `apps/edge-api/src/adapters/metaWhatsAppGraphAdapter.ts`.

O adapter:

- implementa `WhatsAppMessagingPort`;
- recebe `tenant_id` exclusivamente pelo `WhatsAppSendCommandV1`;
- resolve credenciais por `MetaWhatsAppCredentialsResolver.resolveForTenant(tenantId)`;
- não possui fallback para tenant global, primeiro tenant ou único tenant;
- mantém access token fora de contratos de aplicação;
- centraliza a versão Graph em `META_WHATSAPP_GRAPH_VERSION`;
- mantém a versão atual `v25.0` enquanto não houver mudança deliberada e validada;
- usa timeout explícito com `AbortController`;
- limita retries a falhas transitórias;
- não repete erros HTTP 4xx não transitórios;
- normaliza aceitação da Meta como `submitted`, nunca como `sent`;
- propaga `correlation_id`/`idempotency_key` sem enviar payload Meta para o domínio;
- não inclui token, mensagem bruta do provider ou request headers nos erros tipados.

## Erros tipados

`MetaWhatsAppGraphError` expõe somente dados operacionais seguros:

- `code`;
- `retryable`;
- `httpStatus`;
- `providerCode`;
- `providerSubcode`;
- `providerTraceId`;
- `correlationId`.

Códigos atuais:

- `WHATSAPP_GRAPH_NOT_CONFIGURED`;
- `WHATSAPP_GRAPH_TIMEOUT`;
- `WHATSAPP_GRAPH_UNAVAILABLE`;
- `WHATSAPP_GRAPH_REJECTED`;
- `WHATSAPP_GRAPH_INVALID_RESPONSE`.

## Política de retry

O adapter repete somente:

- timeout/AbortError;
- falha de rede;
- HTTP 408;
- HTTP 425;
- HTTP 429;
- HTTP 5xx.

O default é de até 3 tentativas com backoff curto e limitado. HTTP 4xx fora dos casos transitórios não é repetido.

Esta política é de transporte. Idempotência de efeito de aplicação continua sendo responsabilidade das camadas de aplicação/repositório e será conectada ao runtime nas fases WA3/WA5.

## Testes

Arquivo: `apps/edge-api/test/metaWhatsAppGraphAdapter.test.ts`.

Cobertura adicionada:

- endpoint Graph versionado;
- resolução explícita de credencial pelo tenant;
- normalização do destinatário;
- resultado `submitted` com provider message ID;
- ausência de fallback quando não há credencial do tenant;
- rejeição antecipada de destinatário inválido;
- HTTP 4xx não transitório sem retry;
- redaction do access token mesmo quando o provider o ecoa no payload de erro;
- retries de HTTP 429/5xx com backoff;
- falha de rede classificada como transitória;
- AbortError classificado como timeout;
- resposta 2xx inválida sem message ID.

## O que deliberadamente não mudou

- `apps/edge-api/src/whatsappApi.ts`;
- callback configurado na Meta;
- `yuisync.app`;
- secrets/bindings do Worker;
- `.env.example`;
- `wrangler.jsonc`;
- schema/migrations D1;
- Embedded Signup;
- webhook multi-tenant;
- persistência de status;
- Luna/Inbox;
- sincronização de histórico de coexistência.

## Próximo gate

Após CI verde e revisão do WA2, o WA3 deve refatorar o webhook Cloudflare existente para resolver conexão/tenant por `phone_number_id` e, quando necessário, `waba_id`, preservando raw body, assinatura e idempotência.

O adapter WA2 só deve ser conectado ao caminho outbound produtivo no WA5. Isso evita misturar transporte com a migração do webhook.

## Rollback

Reverter/fechar o PR do WA2 restaura exatamente o runtime anterior, pois esta fase é aditiva e não altera configuração externa nem rotas produtivas.
