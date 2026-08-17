# WA3 — Cloudflare WhatsApp Webhook Multi-tenant

Status: **implementado em branch, sem cutover Meta**

Data: 2026-08-17

Base lógica: WA2 validado no head `1070c94e0b74d8cf738efcf40667d4095ec18b17`.

## Objetivo

Evoluir o webhook Cloudflare já existente para uma autoridade multi-tenant real, preservando raw body, HMAC, challenge e o comportamento de ACK, sem trocar callback da Meta e sem conectar ainda o novo outbound do WA2.

## Autoridade de conexão

A migration `0026_whatsapp_connections.sql` adiciona:

- `whatsapp_waba_accounts`: ownership canônico de WABA por tenant;
- `whatsapp_phone_connections`: números associados ao WABA/tenant;
- `whatsapp_ingress_receipts`: claim idempotente de mensagens live antes de efeitos no chat.

Regras de isolamento:

- um `waba_id` não pode pertencer silenciosamente a dois tenants;
- um `phone_number_id` não pode ser reassociado silenciosamente para outro tenant/WABA;
- um mesmo WABA pode possuir vários números dentro do mesmo tenant;
- nenhum fallback para primeiro tenant, único tenant ou bindings globais é permitido no inbound.

## Repository D1

`D1WhatsAppConnectionRepository` implementa `WhatsAppConnectionRepositoryPort` e oferece:

- resolução por tenant;
- resolução por `phone_number_id`;
- resolução por `waba_id`;
- save idempotente com proteção de ownership;
- erros categorizados sem detalhes de banco.

## Webhook

O POST mantém:

1. limite de payload;
2. leitura do raw body;
3. validação `X-Hub-Signature-256` sobre os bytes originais;
4. parse JSON somente após assinatura válida;
5. extração de `entry.id` como `waba_id` e `metadata.phone_number_id`;
6. resolução da conexão pelo `phone_number_id`;
7. conferência do `waba_id` do envelope;
8. conferência de conexão `connected` e tenant ativo com módulo `petshop`;
9. normalização para `IncomingWhatsAppMessageV1`;
10. claim idempotente em `whatsapp_ingress_receipts`;
11. persistência de thread/mensagem somente para o claim vencedor;
12. ACK 200 para eventos válidos porém não roteáveis, sem efeitos.

## Idempotência

O receipt usa `(tenant_id, module_id, provider_message_id)` como chave primária e um `claim_token` por tentativa.

As escritas em `chat_threads` e `chat_messages` são condicionadas ao claim token da tentativa corrente e executadas no mesmo `D1.batch`. Um retry que encontra receipt anterior não atualiza thread nem insere nova mensagem.

## Eventos ignorados com ACK

Após assinatura válida, os seguintes casos são reconhecidos sem efeito operacional e retornam ACK:

- `missing_phone_number_id`;
- `missing_waba_id`;
- `unknown_phone_number_id`;
- `waba_mismatch`;
- `connection_not_connected`;
- `tenant_scope_inactive`;
- `invalid_timestamp`;
- `invalid_message_contract`.

Falha real de D1/repository retorna `503 WHATSAPP_INGRESS_UNAVAILABLE`, permitindo redelivery do provider.

## Compatibilidade preservada

O GET de challenge e a assinatura continuam usando os secrets de aplicação:

- `WHATSAPP_VERIFY_TOKEN`;
- `WHATSAPP_APP_SECRET`.

Os bindings globais antigos de tenant/phone/token permanecem temporariamente apenas no caminho outbound legado. O inbound não consulta `WHATSAPP_TENANT_ID` nem `WHATSAPP_PHONE_NUMBER_ID`.

O caminho outbound será migrado ao adapter WA2 somente no WA5.

## Testes

### Repository

`d1WhatsAppConnectionRepository.test.ts` cobre:

- lookup por tenant/WABA/phone;
- múltiplos números no mesmo WABA/tenant;
- conflito de ownership de WABA;
- conflito de ownership de phone;
- atualização de metadados/status;
- ausência de binding D1.

### Webhook

`whatsappApi.test.ts` usa D1 real do ambiente workerd e cobre:

- HMAC sobre raw body;
- extração de WABA/phone/mensagem;
- challenge GET;
- primeira entrega + retry duplicado com um único efeito;
- assinatura inválida sem persistência;
- phone desconhecido com ACK e zero efeito;
- WABA incompatível com zero efeito;
- dois tenants isolados no mesmo Worker;
- bindings globais legados deliberadamente conflitantes sem alterar o tenant resolvido pelo payload.

## O que não mudou

- callback configurado na Meta;
- secrets reais;
- domínio `yuisync.app`;
- Embedded Signup;
- outbound produtivo;
- status delivery/read;
- Luna/automations;
- histórico de coexistência.

## Gate para WA4

Somente após CI verde/revisão do WA3, o WA4 pode usar o repository de conexões para persistir os assets resolvidos pelo Hosted Embedded Signup.

A aprovação/callback da Meta continua fora deste PR.

## Rollback

Antes de aplicar a migration externamente, rollback é apenas revert/close do PR. Caso a migration já tenha sido aplicada em staging, o código anterior ignora as novas tabelas; portanto o rollback de runtime é compatível e não exige apagar dados imediatamente.
