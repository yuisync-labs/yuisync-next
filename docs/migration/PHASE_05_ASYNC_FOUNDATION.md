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

## Escopo incluído

- ADR de Queues e entrega at-least-once;
- adapter produtor compatível com `DomainEventPublisherPort`;
- validação do `DomainEventEnvelopeV1` antes de publicar e consumir;
- tabela D1 de processamento idempotente;
- claim e conclusão de eventos por chave de idempotência;
- consumidor sem handlers de negócio ativos;
- classificação de erros transitórios e permanentes;
- acknowledgements individuais por mensagem;
- Queue e DLQ exclusivas de staging;
- testes de publicação, redelivery, duplicidade, retry e mensagem inválida;
- logs estruturados com event ID, tenant ID, correlation ID e resultado;
- runbook de backlog, retry, pause, purge e DLQ;
- rollback removendo bindings e consumer trigger.

## Fora do escopo

- eventos reais de produto, serviço, agenda ou pagamento;
- webhooks públicos;
- Workflows;
- Durable Objects;
- R2;
- fila de produção;
- consumidor automático da DLQ;
- replay operacional de dados reais;
- garantias exactly-once;
- substituição de processos do backend Express.

## Filas de staging

```text
yuisync-events-staging
yuisync-events-dlq-staging
```

Configuração inicial proposta:

```text
max_batch_size: 5
max_batch_timeout: 5 segundos
max_retries: 3
retry_delay: 15 segundos
max_concurrency: 2
dead_letter_queue: yuisync-events-dlq-staging
```

Os valores serão revisados depois dos testes de staging. O objetivo inicial é previsibilidade e observabilidade, não throughput máximo.

## Idempotência no D1

A migration da fase criará uma tabela interna, sem dados de negócio:

```text
_yuisync_event_processing
```

Campos mínimos:

- `idempotency_key` como chave primária;
- `event_id` e `event_name`;
- `tenant_id`;
- `status` (`processing`, `succeeded`, `failed`);
- `attempt_count`;
- `first_seen_at`, `last_attempt_at` e `completed_at`;
- `last_error_code` sanitizado.

Regras:

1. nenhum handler executa antes do claim;
2. evento concluído é reconhecido sem repetir efeito;
3. evento em processamento recente solicita retry;
4. falhas não armazenam mensagem, stack ou payload;
5. a chave de transporte da Queue não substitui `idempotency_key`.

## Consumidor inicial

A primeira allowlist conterá apenas um evento interno de canário:

```text
system.async_canary.requested.v1
```

O handler canário não executará integração externa. Ele validará contrato, claim, conclusão, logs e acknowledgements. Eventos desconhecidos serão classificados como permanentes e seguirão a política de retry/DLQ sem serem executados.

## Ordem de implementação

1. aceitar ADR-0003;
2. criar contrato/allowlist do canário;
3. implementar producer adapter com Queue injetável;
4. criar migration e repository idempotente D1;
5. implementar processador puro de mensagens;
6. compor o handler `queue()` no Worker;
7. testar batches, duplicidade e falhas no `workerd`;
8. criar Queue e DLQ de staging por workflow protegido;
9. configurar producer binding e consumer trigger;
10. publicar canário protegido;
11. validar ack, redelivery, retry e DLQ;
12. ensaiar rollback retirando producer/consumer bindings;
13. remover workflows temporários;
14. integrar somente com CI e staging verdes.

## Observabilidade

Eventos de log previstos:

```text
edge.queue.batch.started
edge.queue.message.claimed
edge.queue.message.duplicate
edge.queue.message.succeeded
edge.queue.message.retry
edge.queue.message.rejected
edge.queue.batch.completed
```

Campos permitidos:

- `event_id`;
- `event_name`;
- `tenant_id`;
- `correlation_id`;
- `attempts`;
- `result`;
- `error_code` sanitizado;
- `duration_ms`.

Payload, SQL, stack trace, telefone, mensagem de cliente e conteúdo de integrações não podem ser registrados.

## Gates obrigatórios

- [x] branch da Fase 5 criada;
- [x] decisão arquitetural documentada;
- [ ] contrato de canário e allowlist;
- [ ] producer adapter;
- [ ] migration de idempotência;
- [ ] repository D1 de claim/conclusão;
- [ ] consumidor com ack/retry individual;
- [ ] testes no `workerd`;
- [ ] CI completa sem regressões;
- [ ] Queue e DLQ de staging;
- [ ] canário ao vivo;
- [ ] redelivery idempotente ao vivo;
- [ ] retry e DLQ validados;
- [ ] logs sanitizados;
- [ ] rollback ensaiado;
- [ ] runbook operacional.

## Rollback

O rollback do runtime remove producer bindings e consumer triggers e republica o Worker. O D1 e a tabela interna permanecem para auditoria, sem receber novos eventos. Como nenhum fluxo real será ativado nesta fase, não haverá rollback de dados de negócio.

## Critério de saída

A fase termina quando um evento canário versionado puder ser publicado e consumido em staging, com idempotência comprovada sob redelivery, retries e DLQ observáveis, rollback validado e nenhuma alteração no comportamento do sistema legado.
