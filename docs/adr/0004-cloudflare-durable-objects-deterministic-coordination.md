# ADR-0004 — Coordenação determinística com Cloudflare Durable Objects

- Status: accepted
- Data: 2026-08-06
- Relacionados: ADR-0001, ADR-0002, ADR-0003

## Contexto

Reservas de horário são operações concorrentes. Duas requisições podem consultar o mesmo intervalo como disponível e tentar confirmá-lo simultaneamente. Um `SELECT` seguido de `INSERT` em processos independentes não fornece, sozinho, uma autoridade serializada por agenda.

O YuiSync precisa impedir confirmações conflitantes sem transformar toda a aplicação em um sistema stateful e sem entregar o controle do fluxo à LLM.

## Decisão

Adotar Cloudflare Durable Objects como autoridade de coordenação por escopo, mantendo o D1 como banco principal dos registros de negócio da nova arquitetura.

Cada instância será identificada por uma chave canônica versionada:

```text
v1|tenant_id|resource_type|resource_id
```

Exemplos futuros de recurso:

```text
professional_schedule
petshop_vehicle_route
shared_service_capacity
```

Nunca será usado um Durable Object global para todos os tenants ou todas as agendas.

## Responsabilidades do coordenador

O Durable Object deverá:

- serializar claims concorrentes do mesmo escopo;
- persistir operações e leases em SQLite local ao objeto;
- emitir fencing tokens estritamente crescentes;
- deduplicar por chave idempotente;
- rejeitar conclusões de holders antigos;
- recuperar operações interrompidas após expiração da lease;
- expor somente RPC interno e tipado;
- registrar apenas metadados sanitizados.

O Durable Object não deverá:

- interpretar linguagem natural;
- escolher serviços, profissionais ou horários;
- armazenar conversa de cliente;
- substituir o D1 como catálogo ou banco principal de agendamentos;
- publicar rotas públicas de coordenação;
- funcionar como singleton global.

## Persistência e consistência

Novas classes usarão Durable Objects com armazenamento SQLite.

A operação futura seguirá o padrão:

```text
claim persistido no Durable Object
  -> escrita idempotente no D1 com fencing token
  -> publicação de evento versionado
  -> conclusão persistida no Durable Object
```

Não existe transação distribuída entre Durable Object, D1 e Queue. A recuperação será baseada em:

- idempotência;
- leases com expiração;
- fencing tokens;
- estados persistidos;
- retries categorizados;
- reconciliação explícita.

Nenhum efeito externo poderá depender apenas de estado em memória.

## Lifecycle e configuração

Quando a classe for conectada ao Worker:

- será declarada com lifecycle `exports` e storage `sqlite`;
- bindings serão configurados explicitamente por ambiente;
- local e test serão ativados antes de staging;
- staging terá feature flag própria;
- produção permanecerá fora desta fase.

## API interna

A primeira porta contém somente:

```text
claim(scope, operation, idempotency, lease)
complete(scope, operation, fencing_token)
```

Resultados possíveis incluem:

```text
claimed
duplicate
busy
conflict
completed
expired
stale
not_found
```

O primeiro incremento implementa essa semântica como máquina de estados pura e testável. Binding, SQLite e RPC serão adicionados em incrementos posteriores da mesma PR.

## Segurança

- IDs e chaves terão tamanho limitado;
- erros serão categorizados e sanitizados;
- payloads de negócio não serão registrados;
- o fencing token será obrigatório em conclusões;
- o namespace de staging não será criado antes dos testes locais;
- nenhuma rota pública permitirá controlar locks.

## Consequências

### Positivas

- exclusão por agenda sem lock global;
- redução de condições de corrida;
- recuperação após reinício ou eviction;
- base reutilizável para capacidade compartilhada;
- separação entre coordenação e persistência de negócio.

### Custos

- mais um estado persistente a observar;
- necessidade de reconciliação entre DO e D1;
- lifecycle de classe exige disciplina operacional;
- testes precisam cobrir eviction, redelivery e holders obsoletos.

## Rollback

O rollback desabilita a feature flag, remove o binding do Worker e interrompe novas chamadas ao coordenador. O namespace e o armazenamento permanecem inativos para auditoria e recuperação. Como nenhum agendamento real será ativado nesta fase, não haverá rollback de dados de clientes.

## Referências

- https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/
