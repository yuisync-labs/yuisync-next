# Fase 5 — Fundação assíncrona com Cloudflare Queues

## Objetivo

Criar a primeira infraestrutura assíncrona da nova arquitetura usando Cloudflare Queues, eventos versionados, idempotência persistida no D1, retries categorizados e Dead Letter Queue, sem ativar fluxos reais de pedidos, agenda, pagamentos ou mensagens.

```text
Cloudflare Worker
  -> DomainEventPublisherPort
  -> Queue principal
  -> consumidor Worker
  -> idempotência no D1
  -> ack, retry ou DLQ
```

## Escopo entregue

- ADR de entrega at-least-once;
- adapter produtor compatível com `DomainEventPublisherPort`;
- validação do `DomainEventEnvelopeV1` na publicação e no consumo;
- contrato estrito `AsyncCanaryEventV1`;
- allowlist contendo apenas `system.async_canary.requested.v1`;
- migration D1 `0002_event_processing.sql`;
- repository de claim, conclusão e falha;
- leases para recuperação de processamento interrompido;
- processador de batch com `ack()` e `retry()` individuais;
- consumer handler `queue()` no Worker;
- feature gate `EDGE_ASYNC_ENABLED`;
- producer binding `EVENTS_QUEUE`;
- Queue e DLQ exclusivas de staging;
- testes de publicação, concorrência, redelivery, duplicidade e falha;
- observabilidade sanitizada;
- runbook de backlog, pause, resume, purge e DLQ;
- ensaios ao vivo de canário, idempotência, DLQ e rollback.

## Fora do escopo

- eventos reais de produto, serviço, agenda ou pagamento;
- webhooks públicos;
- Workflows;
- Durable Objects;
- R2;
- filas de produção;
- consumidor automático da DLQ;
- replay operacional de dados reais;
- garantias exactly-once;
- substituição de processos do backend Express.

## Recursos de staging

```text
Queue: yuisync-events-staging
DLQ: yuisync-events-dlq-staging
Producer binding: EVENTS_QUEUE
D1: yuisync-next-staging
Feature gate: EDGE_ASYNC_ENABLED
```

Configuração validada:

```text
max_batch_size: 5
max_batch_timeout: 5 segundos
max_retries: 3
retry_delay: 15 segundos
max_concurrency: 2
dead_letter_queue: yuisync-events-dlq-staging
```

## Idempotência no D1

A migration criou a tabela interna:

```text
_yuisync_event_processing
```

Identidade e estado:

- chave primária composta por `tenant_id` e `idempotency_key`;
- `event_id` único;
- `event_name` e `event_version` imutáveis para a chave;
- estados `processing`, `succeeded` e `failed`;
- `attempt_count`;
- `claim_token`;
- `lease_expires_at_ms`;
- timestamps técnicos;
- `last_error_code` sanitizado.

Regras implementadas:

1. nenhum handler executa antes do claim atômico;
2. apenas um claim concorrente vence;
3. evento concluído recebe ack sem repetir efeito;
4. processamento com lease ativo solicita retry;
5. lease expirada pode ser recuperada;
6. falha permite redelivery e incrementa a tentativa;
7. reutilização da chave para outro evento é conflito;
8. payload, SQL e stack não são persistidos como erro.

## Consumidor

A allowlist contém apenas:

```text
system.async_canary.requested.v1
```

O canário valida contrato, D1, logs e acknowledgements sem integração externa. Eventos desconhecidos não executam handler: recebem retry individual e seguem para a DLQ ao exceder o limite.

Quando `EDGE_ASYNC_ENABLED=false`, o lote não acessa D1 nem executa handler; todas as mensagens são reagendadas com atraso operacional.

## Testes no runtime Workers

Os testes no `workerd` cobrem:

- producer binding injetável;
- contrato e allowlist;
- claim concorrente;
- conclusão idempotente;
- falha seguida de redelivery;
- lease ativa e expirada;
- conflito de chave;
- batch parcialmente bem-sucedido;
- ack de duplicata concluída;
- retry de claim ativo;
- erro de handler sanitizado;
- indisponibilidade do D1;
- feature gate desligada;
- migration e schema version 2.

## Validação ao vivo

O staging foi validado em ambiente protegido:

```text
canário publicado
  -> succeeded
  -> attempt_count = 1

mesmo envelope publicado novamente
  -> ack de duplicata
  -> attempt_count permanece 1

evento incompatível
  -> retries individuais
  -> DLQ após o limite

Queue pausada
  -> mensagem preservada

Queue retomada
  -> mensagem processada
  -> succeeded
```

Ao final, a entrega foi retomada e os backlogs de teste da Queue e da DLQ foram limpos.

## Observabilidade

Eventos implementados incluem:

```text
edge.queue.message.acked
edge.queue.message.duplicate_acked
edge.queue.message.retry_scheduled
edge.queue.message.rejected
edge.queue.batch.completed
edge.queue.batch.disabled
edge.async_canary.processed
```

Campos permitidos:

- `message_id`;
- `event_id`;
- `tenant_id`;
- `correlation_id`;
- tentativa;
- resultado;
- motivo categorizado.

Payload, SQL, stack trace, telefone, mensagem de cliente e credenciais não podem ser registrados.

## Rollback

O rollback operacional validado usa pause/resume da Queue:

```text
pause delivery
  -> novas mensagens permanecem armazenadas
  -> consumidor deixa de receber

resume delivery
  -> backlog volta a ser consumido
  -> idempotência permanece ativa
```

Também é possível desligar `EDGE_ASYNC_ENABLED` ou republicar a versão estável do Worker. D1, Queue e DLQ permanecem para auditoria. Purge não é mecanismo de rollback.

## Gates obrigatórios

- [x] branch da Fase 5 criada;
- [x] decisão arquitetural documentada;
- [x] contrato de canário e allowlist;
- [x] producer adapter;
- [x] migration de idempotência;
- [x] repository D1 de claim/conclusão;
- [x] consumidor com ack/retry individual;
- [x] testes no `workerd`;
- [x] Queue e DLQ de staging;
- [x] canário ao vivo;
- [x] redelivery idempotente ao vivo;
- [x] retry e DLQ validados;
- [x] logs sanitizados;
- [x] rollback ensaiado;
- [x] runbook operacional;
- [x] workflows temporários removidos;
- [x] CI final no SHA exato da PR;
- [x] nenhuma regressão no legado.

## Critério de saída

A fase está concluída com CI verde, preservando o Worker e o legado, com o evento canário versionado publicado e consumido em staging, idempotência comprovada sob redelivery, DLQ observável e rollback validado.
