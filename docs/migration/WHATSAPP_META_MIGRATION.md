# Migração Meta / WhatsApp para Cloudflare

Status: **PR-WA1 — Inventory + Contracts**

Data do audit: 2026-08-17

Base auditada: `main` em `fdfa84372fc8f9e43d66a95362d46830d2c5c5ed`.

## Objetivo desta fase

Criar uma fronteira estável entre WhatsApp, aplicação e infraestrutura sem alterar o comportamento produtivo existente.

Este PR é deliberadamente aditivo. Ele não troca callback na Meta, não altera secrets, não muda o banco, não desliga o legado e não conecta os novos contratos ao runtime.

## Princípios preservados

- Cloudflare-first e monólito modular;
- contratos e domínio não dependem de payload bruto da Meta, Cloudflare, Vercel, Supabase ou `fetch`;
- integração WhatsApp é um adapter;
- tenant é obrigatório em toda operação de aplicação;
- nenhum adapter pode escolher silenciosamente um tenant global;
- webhooks e envio exigem idempotência;
- migração é incremental, reversível e sem big-bang rewrite;
- banco, autenticação e integração WhatsApp não são migrados juntos por conveniência.

## Inventário atual

### Runtime Cloudflare já existente

`apps/edge-api/src/index.ts` encaminha requisições WhatsApp para `handleWhatsappApiRequest`.

`apps/edge-api/src/whatsappApi.ts` já contém uma implementação inicial de WhatsApp no Worker com:

- `GET /api/whatsapp/webhook`;
- `POST /api/whatsapp/webhook`;
- alias `/api/whatsapp-webhook`;
- `POST /api/whatsapp/send`;
- validação de `X-Hub-Signature-256` sobre raw body;
- limite de payload;
- deduplicação por `external_message_id` no armazenamento atual;
- persistência direta em D1;
- autorização de envio;
- chamada direta à Graph API.

Essa implementação é uma fundação útil, mas ainda não é o desenho multi-tenant final. O escopo atual é escolhido por bindings globais como `WHATSAPP_TENANT_ID` e `WHATSAPP_PHONE_NUMBER_ID`, e a rota ainda conhece D1 e Graph API diretamente.

### Legado ainda presente

A árvore antiga continua responsável por compatibilidade e por fluxos que não devem ser removidos neste PR:

- `api/webhook.ts`;
- `serverless/whatsappWebhook.ts`;
- `serverless/metaWhatsappApi.ts`;
- `server/lib/whatsapp.js`.

Nessa área ainda coexistem detalhes de Express/Vercel, Supabase, Graph API, resolução de tenant, Inbox, Luna, histórico de coexistência, templates, subscription e envio.

### Configuração e secrets

`.env.example` ainda documenta variáveis globais de compatibilidade para WhatsApp. Nenhuma delas é removida ou alterada no WA1.

`apps/edge-api/wrangler.jsonc` já possui infraestrutura de Queue/DLQ em staging para eventos do projeto. O WA1 não conecta webhooks WhatsApp à Queue; essa decisão pertence ao WA3 e deve considerar a foundation efetivamente disponível no momento da implementação.

## Dívidas e riscos identificados

1. **Single-tenant no edge atual** — o Worker usa tenant e phone number globais por bindings.
2. **Graph API dentro da rota** — `apps/edge-api/src/whatsappApi.ts` executa `fetch` diretamente, sem um port de mensageria.
3. **Persistência dentro da rota** — webhook e outbound conhecem D1 e tabelas diretamente.
4. **Implementações paralelas** — edge e legado podem divergir em regras e tratamento de erro.
5. **Fallbacks globais no legado** — existem caminhos baseados em WABA/phone/token globais e heurísticas de tenant que não podem ser a autoridade final multi-tenant.
6. **Versão Graph espalhada historicamente** — código legado e novo não devem manter versões independentes no desenho final.
7. **Status otimista** — o edge atual grava outbound com `delivery_status: 'sent'` após aceitação da chamada, sem ainda possuir reconciliação completa de `submitted/sent/delivered/read/failed`.
8. **Histórico de coexistência não verificado** — há código legado para eventos de histórico, mas ele não deve ser promovido ao Next como contrato oficial sem documentação atual da Meta e fixture real sanitizada.
9. **Idempotência parcial** — existe deduplicação de mensagem, mas o WA3 deve provar explicitamente que webhook duplicado produz um único efeito de aplicação.

## Contratos canônicos introduzidos no WA1

Arquivo: `shared/contracts/v1/whatsapp.ts`.

### `WhatsAppAccountConnectionV1`

Representa o vínculo normalizado de um tenant com seus assets WhatsApp:

- `tenant_id`;
- `business_id`;
- `waba_id`;
- `phone_number_id`;
- metadados públicos opcionais;
- `status` (`pending`, `connected`, `disabled`).

Credenciais, access tokens, app secrets e payloads Meta não fazem parte do contrato.

### `IncomingWhatsAppMessageV1`

Representa somente uma mensagem **nova já normalizada** recebida pela aplicação.

Possui tenant, WABA, phone number, message ID, remetente, timestamp ISO, tipo, texto opcional e correlation ID.

`timestamp` bruto da Meta e envelope `entry/changes/value` não atravessam essa fronteira.

**Importante:** este contrato não caracteriza sincronização histórica de coexistência. Histórico terá contrato separado somente no WA6, após verificação oficial. `historical message != new incoming customer message` continua sendo uma invariável obrigatória.

### `WhatsAppSendCommandV1`

Comando de envio textual com:

- tenant explícito;
- conversation ID;
- destinatário;
- corpo;
- `idempotency_key` obrigatória;
- correlation ID opcional.

### `WhatsAppSendResultV1`

Resultado normalizado do transporte, com lifecycle mínimo:

- `queued`;
- `submitted`;
- `sent`;
- `delivered`;
- `read`;
- `failed`.

O contrato permite diferenciar aceitação do transporte de entrega real e evita que a UI precise inferir sucesso a partir de uma gravação otimista.

## Ports introduzidos no WA1

Arquivo: `server/application/ports/whatsapp.ts`.

### `WhatsAppConnectionRepositoryPort`

Fronteira para:

- listar conexões de um tenant;
- resolver conexão por `phone_number_id`;
- resolver conexões por WABA;
- persistir vínculo normalizado.

A escolha do armazenamento permanece fora da aplicação.

### `WhatsAppMessagingPort`

Único contrato de envio textual:

```ts
sendText(command: WhatsAppSendCommandV1): Promise<WhatsAppSendResultV1>
```

Luna, atendimento humano, rotas, jobs e outros consumidores deverão convergir para esse port em fases posteriores, sem implementar chamadas próprias à Graph API.

## Contratos já existentes que serão preservados

- `TenantContextV1` para contexto/autorização de tenant;
- `InboundMessageV1` como contrato genérico de mensagem após a fronteira específica do canal quando aplicável;
- `DomainEventEnvelopeV1`, `DomainEventPublisherPort` e `EventProcessingRepositoryPort` para processamento assíncrono/idempotente quando WA3 justificar Queue.

O WA1 não cria duplicatas desses conceitos.

## Mapa de migração

| Área | Estado atual | Próxima fase | Regra |
|---|---|---|---|
| Contratos WhatsApp | ausentes | WA1 | vendor-neutral |
| Ports WhatsApp | ausentes | WA1 | sem I/O/vendor |
| Webhook Cloudflare | implementação inicial existente | WA3 | trocar scope global por resolução multi-tenant via conexão |
| Assinatura webhook | já existe no edge | WA3 | preservar raw body e cobrir com testes obrigatórios |
| Idempotência webhook | dedupe de mensagem existente | WA3 | provar um único efeito de aplicação |
| Graph API | `fetch` direto no edge/legado | WA2 | adapter dedicado, erro tipado, timeout e versão centralizada |
| Embedded Signup | legado/parcial | WA4 | browser inicia; backend valida/resolve/persiste/subscreve |
| Outbound | direto no edge e legado | WA5 | convergir para `WhatsAppMessagingPort` |
| Status | incompleto | WA5 | reconciliar por resposta/webhook |
| Coexistence history | lógica legada não verificada | WA6 | bloquear implementação até docs oficiais + fixture real sanitizada |
| Callback `yuisync.app` | não realizar agora | WA7 | cutover separado com gates e rollback |

## Plano das próximas fases

### WA2 — Meta Graph Adapter

Criar adapter dedicado para somente as operações necessárias, com versão Graph centralizada, timeout, erro tipado, redaction, correlação e retry apenas transitório. Nenhum cutover.

### WA3 — Cloudflare Webhook multi-tenant

Refatorar a implementação edge existente para:

1. preservar GET verification e validação de assinatura;
2. normalizar o evento em contrato;
3. resolver tenant por `phone_number_id` e, quando necessário, WABA;
4. não usar fallback para primeiro/único tenant;
5. garantir dedupe antes de side effects;
6. usar Queue somente se a foundation estiver pronta e trouxer benefício operacional;
7. cobrir unknown phone, duplicate delivery e tenant isolation.

O callback produtivo permanece no legado até os gates de homologação/cutover.

### WA4 — Embedded Signup + onboarding

Frontend apenas inicia o Hosted Embedded Signup e envia ao backend o resultado permitido. Backend resolve assets, persiste vínculo multi-tenant e assina WABA idempotentemente. Tokens nunca chegam ao browser.

### WA5 — Outbound + status reconciliation

Migrar todos os produtores de mensagens para `WhatsAppMessagingPort`, implementar regras da janela de atendimento/templates e reconciliar estados reais.

### WA6 — Coexistence History Sync

Somente após consulta à documentação oficial atual da Meta e captura de fixture real sanitizada. Criar ADR específico antes de importar dados.

### WA7 — `yuisync.app` cutover

Mudança exclusiva de domínio/callback, com smoke tests, observação e rollback para o endpoint anterior.

## Testes do WA1

`test/contracts/v1/whatsapp.test.ts` cobre:

- vínculo mínimo válido;
- metadados públicos opcionais;
- tenant obrigatório;
- rejeição de secrets/campos extras;
- mensagem textual normalizada;
- texto obrigatório para `message_type=text`;
- rejeição de timestamp bruto/payload Meta bruto;
- idempotency key obrigatória no envio;
- tenant obrigatório no envio;
- corpo vazio rejeitado;
- resultado `submitted`;
- resultado `failed` categorizado.

Além dos testes unitários, `typecheck:contracts` valida que os ports dependem apenas dos contratos permitidos.

## Definition of Done do WA1

- [x] audit read-only da `main` realizado antes de alterações funcionais;
- [x] inventário de edge + legado documentado;
- [x] contratos WhatsApp v1 definidos;
- [x] ports WhatsApp definidos;
- [x] contratos exportados pelo entrypoint existente;
- [x] ports exportados pelo entrypoint existente;
- [x] testes de contratos adicionados;
- [ ] suíte/linters/typecheck/build confirmados pelo CI;
- [x] nenhum callback alterado;
- [x] nenhum secret alterado;
- [x] nenhuma configuração Meta alterada;
- [x] nenhum runtime WhatsApp alterado;
- [x] nenhum banco migrado;
- [x] nenhum caminho legado removido.

## Rollback do WA1

O WA1 é aditivo e não está ligado ao runtime. O rollback consiste em reverter/fechar este PR.

Não há ação de rollback na Meta, Cloudflare, banco ou callback porque nenhuma dessas superfícies é alterada nesta fase.

## Gate para iniciar WA2

WA2 só deve começar depois que este PR estiver revisado e verde. A existência dos contratos não autoriza troca de callback nem alteração automática da configuração Meta.
