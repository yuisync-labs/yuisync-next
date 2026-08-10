# ADR-0003 — Cloudflare Queues com eventos idempotentes

- Status: accepted
- Data: 2026-08-06
- Decisores: YuiSync

## Contexto

O novo runtime precisa executar trabalho assíncrono sem acoplar solicitações HTTP a integrações lentas, retries ou indisponibilidades externas. Cloudflare Queues entrega mensagens pelo menos uma vez; portanto, uma mesma mensagem pode ser processada novamente e nenhum consumidor pode pressupor entrega única.

A Fase 4 estabeleceu D1 como banco principal e criou contratos de eventos de domínio versionados. A fundação assíncrona deve reutilizar esses contratos sem permitir que SDKs Cloudflare atravessem os ports de aplicação.

## Decisão

Adotar o seguinte fluxo:

```text
caso de uso
  -> DomainEventPublisherPort
  -> adapter Cloudflare Queue
  -> Queue principal
  -> consumidor Worker
  -> claim idempotente no D1
  -> handler categorizado
  -> ack, retry ou DLQ
```

### Filas iniciais

- `yuisync-events-staging`: eventos internos do ambiente de staging;
- `yuisync-events-dlq-staging`: mensagens que excederem o limite de retries.

Nenhuma fila de produção será criada nesta fase.

### Contrato da mensagem

Toda mensagem será um `DomainEventEnvelopeV1` validado antes da publicação e novamente antes do processamento. Campos obrigatórios incluem `event_id`, `event_name`, `event_version`, `tenant_id`, `correlation_id` e `idempotency_key`.

Mensagens inválidas não serão encaminhadas a handlers de negócio. O consumidor registrará somente códigos sanitizados e permitirá que a política da Queue as conduza à DLQ.

### Idempotência

O consumidor fará um claim atômico no D1 usando `idempotency_key` como chave única. Estados iniciais:

```text
processing
succeeded
failed
```

- `succeeded`: redelivery é reconhecida sem repetir efeito;
- `processing`: redelivery recente é adiada/repetida;
- `failed`: pode ser reclamada conforme política explícita e contador de tentativas;
- nenhuma operação externa será executada antes do claim.

A infraestrutura não promete exactly-once. O objetivo é efeito observável idempotente sobre entrega at-least-once.

### Retries e DLQ

O consumidor usará acknowledgements individuais quando possível, evitando repetir mensagens já concluídas dentro de um batch. Erros transitórios solicitam retry; erros permanentes percorrem o limite configurado e terminam na DLQ. A DLQ não terá consumidor automático nesta primeira etapa.

### Limites

- lote pequeno no início;
- concorrência limitada em staging;
- payload máximo interno muito menor que o limite da plataforma;
- sem dados binários ou documentos nas mensagens;
- arquivos e payloads grandes serão referenciados por identificador R2 futuramente;
- nenhum endpoint público aceitará eventos arbitrários nesta fase.

## Alternativas consideradas

### Processar tudo dentro da requisição HTTP

Rejeitada porque aumenta latência, mistura retries com experiência do usuário e propaga indisponibilidades externas.

### Workflows para todo processamento assíncrono

Rejeitada como padrão geral. Workflows serão usados para processos longos e multi-etapas; Queues serão o mecanismo inicial para eventos curtos, desacoplados e de alto volume.

### Confiar no ID da mensagem fornecido pela Queue

Rejeitada. O ID de transporte não substitui a chave de idempotência do domínio e não deve definir semântica de negócio.

### Exactly-once por infraestrutura

Rejeitada como premissa. A entrega é tratada como at-least-once e os efeitos devem ser idempotentes.

## Consequências positivas

- runtime e integrações desacoplados;
- retries e DLQ explícitos;
- proteção contra redelivery;
- contratos versionados reutilizados;
- observabilidade por evento e correlation ID;
- infraestrutura centralizada na Cloudflare.

## Consequências negativas

- processamento passa a ser eventualmente consistente;
- exige tabela e política de idempotência;
- handlers precisam classificar erros transitórios e permanentes;
- DLQ exige operação e runbook próprios;
- testes precisam simular redelivery e batches parciais.

## Restrições de segurança

- nenhum secret, SQL, payload completo ou dado pessoal em logs;
- nenhum handler de negócio ativado nesta primeira fundação;
- nenhuma publicação para produção;
- eventos desconhecidos são rejeitados por allowlist;
- toda consulta e claim inclui contexto de tenant quando aplicável;
- migrations aplicadas são imutáveis.

## Critérios de revisão

Reavaliar antes de habilitar o primeiro evento de negócio, com métricas de throughput, retries, custo, tamanho de payload, backlog, idade das mensagens e comportamento da DLQ em staging.
