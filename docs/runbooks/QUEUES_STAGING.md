# Runbook — Cloudflare Queues de staging

## Objetivo

Operar exclusivamente a fundação assíncrona de staging do YuiSync. Este runbook não autoriza eventos de negócio, filas de produção, replay de dados reais ou alterações no backend Express.

## Recursos

```text
Worker: yuisync-edge-api-staging
Queue principal: yuisync-events-staging
Dead Letter Queue: yuisync-events-dlq-staging
D1: yuisync-next-staging
Producer binding: EVENTS_QUEUE
Feature gate: EDGE_ASYNC_ENABLED
```

Configuração do consumidor:

```text
max_batch_size: 5
max_batch_timeout: 5 segundos
max_retries: 3
retry_delay: 15 segundos
max_concurrency: 2
dead_letter_queue: yuisync-events-dlq-staging
```

## Evento permitido nesta fase

Somente o canário abaixo pode executar handler:

```text
system.async_canary.requested.v1
```

Eventos desconhecidos não executam efeito. Eles recebem retry individual e, após o limite, seguem para a DLQ.

## Deploy

Antes de publicar o Worker:

```bash
npm ci
```

```bash
npm run edge:check
```

Aplique migrations antes do deploy:

```bash
npx wrangler d1 migrations apply yuisync-next-staging --env staging --remote --cwd apps/edge-api
```

Publique o Worker:

```bash
npm run deploy:staging --workspace @yuisync/edge-api
```

O deploy só deve ocorrer pelo GitHub Environment `cloudflare-staging`, com credenciais Cloudflare armazenadas como secrets.

## Observabilidade

No Cloudflare Dashboard, acompanhe o Worker e as duas filas. Verifique principalmente:

```text
edge.queue.message.acked
edge.queue.message.duplicate_acked
edge.queue.message.retry_scheduled
edge.queue.message.rejected
edge.queue.batch.completed
edge.queue.batch.disabled
edge.async_canary.processed
```

Campos permitidos incluem IDs técnicos, tenant ID, correlation ID, tentativa e motivo categorizado. Payload, SQL, stack trace, mensagens de cliente e credenciais não podem aparecer nos logs.

## Idempotência no D1

O estado fica em:

```text
_yuisync_event_processing
```

Uma entrega saudável termina com:

```text
status = succeeded
attempt_count >= 1
```

Uma redelivery de evento já concluído deve ser reconhecida sem incrementar `attempt_count` e sem executar o handler novamente.

Nunca altere manualmente uma linha para forçar replay. Replay deverá ser uma operação versionada e auditável em fase futura.

## Pausar e restaurar a entrega

Pause a Queue quando o consumidor estiver instável:

```bash
npx wrangler queues pause-delivery yuisync-events-staging --cwd apps/edge-api
```

A Queue continua aceitando e armazenando mensagens enquanto pausada.

Restaure a entrega:

```bash
npx wrangler queues resume-delivery yuisync-events-staging --cwd apps/edge-api
```

Confirme após a restauração:

- backlog diminuindo;
- eventos canário terminando em `succeeded`;
- ausência de crescimento inesperado da DLQ;
- logs correlacionados por mensagem.

## Dead Letter Queue

Uma mensagem chega à DLQ depois de exceder `max_retries`. A DLQ não possui consumidor automático nesta fase.

Ao encontrar backlog na DLQ:

1. mantenha a Queue principal operando apenas quando a falha estiver isolada;
2. identifique o `event_name`, correlation ID e erro categorizado nos logs;
3. não copie payloads para comentários ou tickets;
4. corrija contrato ou handler antes de qualquer replay;
5. registre responsável, causa e decisão de descarte ou replay.

## Purge

Purge é destrutivo e só pode ser usado nas filas de staging desta fase:

```bash
npx wrangler queues purge yuisync-events-staging --force --cwd apps/edge-api
```

```bash
npx wrangler queues purge yuisync-events-dlq-staging --force --cwd apps/edge-api
```

Não publique mensagens imediatamente após um purge. Aguarde a propagação da limpeza antes de iniciar novo canário.

## Rollback

Ordem recomendada:

1. pause `yuisync-events-staging`;
2. desligue `EDGE_ASYNC_ENABLED` ou publique a versão estável anterior;
3. confirme que nenhum handler novo está executando;
4. preserve D1, Queue e DLQ para auditoria;
5. corrija e valide localmente;
6. republique a versão aprovada;
7. retome a entrega;
8. confirme consumo idempotente do backlog.

A pausa é preferível ao purge porque preserva mensagens. A tabela D1 não deve ser removida durante rollback.

## Validação comprovada na Fase 5

O staging foi validado com:

```text
canário normal → succeeded, attempt_count = 1
mesmo canário publicado novamente → efeito não repetido
mensagem incompatível → retries → DLQ
Queue pausada → mensagem preservada
Queue retomada → mensagem processada
cleanup final → Queue e DLQ sem backlog de teste
```

## Registro obrigatório

Registre para cada operação:

- horário UTC;
- responsável e aprovador;
- SHA e version ID do Worker;
- Queue afetada;
- evento técnico usado no canário;
- resultado no D1;
- backlog antes e depois;
- confirmação dos logs estruturados.
