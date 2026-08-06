# Fase 6 — Coordenação determinística com Durable Objects

## Objetivo

Criar a camada de coordenação stateful da nova arquitetura para impedir operações concorrentes conflitantes por tenant e recurso, sem ativar agendamentos reais.

```text
caso de uso
  -> CoordinationPort
  -> Durable Object por escopo
  -> claim persistido
  -> fencing token
  -> escrita idempotente no D1
  -> evento versionado na Queue
```

## Escopo incluído

- ADR de coordenação determinística;
- porta tipada de claim e conclusão;
- máquina de estados pura com leases;
- fencing tokens crescentes;
- deduplicação por chave idempotente;
- rejeição de holders obsoletos;
- classe Durable Object com SQLite;
- RPC interno, sem rota pública;
- binding somente em local/test no primeiro momento;
- testes no `workerd`;
- teste de eviction e recuperação do estado persistido;
- staging protegido com canários técnicos;
- runbook de inspeção, desativação e rollback.

## Fora do escopo

- reservas reais de banho e tosa;
- escolha automática de profissional;
- bloqueio de horários do sistema legado;
- pagamento;
- calendário público;
- WebSockets;
- alarms de negócio;
- produção;
- singleton global;
- armazenamento de conversa ou payload de cliente no Durable Object.

## Particionamento

Cada coordenador representa somente um escopo:

```text
v1|tenant_id|resource_type|resource_id
```

A identidade será derivada por `idFromName()` a partir da chave canônica. Nenhuma requisição poderá escolher um objeto global compartilhado entre tenants.

## Semântica inicial

### Claim

```text
sem holder ativo
  -> claimed
  -> fencing token N
  -> lease persistida

mesma chave e mesma operação
  -> duplicate
  -> nenhum novo token

outra operação durante lease ativa
  -> busy

lease expirada
  -> claim recuperado
  -> fencing token N + 1
```

### Conclusão

```text
holder e token atuais
  -> completed

operação já concluída
  -> duplicate

token antigo
  -> stale

lease expirada
  -> expired
```

## Ordem de implementação

1. criar branch e PR draft;
2. aceitar ADR-0004;
3. adicionar porta de coordenação;
4. implementar máquina de estados pura;
5. validar leases, idempotência e fencing tokens;
6. criar classe SQLite-backed Durable Object;
7. configurar lifecycle declarativo e binding de test;
8. testar RPC diretamente no `workerd`;
9. testar persistência após eviction;
10. adicionar adapter compatível com `CoordinationPort`;
11. adicionar feature flag fail-closed;
12. criar staging namespace por workflow protegido;
13. executar canários concorrentes;
14. ensaiar rollback removendo o binding;
15. remover workflows temporários;
16. integrar somente com todos os gates verdes.

## Observabilidade

Eventos previstos:

```text
edge.coordination.claimed
edge.coordination.duplicate
edge.coordination.busy
edge.coordination.completed
edge.coordination.expired
edge.coordination.stale
edge.coordination.recovered
```

Campos permitidos:

- tenant ID;
- resource type;
- resource ID;
- operation ID;
- fencing token;
- resultado;
- duração;
- ambiente.

Não registrar nomes de clientes, telefones, mensagens, dados do pet, payload integral ou stack trace.

## Gates

- [x] branch criada sobre o merge da PR5;
- [x] ADR-0004 aceito;
- [x] porta de coordenação;
- [x] máquina de estados pura;
- [x] testes de lease, duplicidade e fencing token;
- [ ] classe Durable Object SQLite;
- [ ] binding local/test;
- [ ] RPC interno;
- [ ] persistência após eviction;
- [ ] adapter da porta;
- [ ] feature flag;
- [ ] CI completa;
- [ ] namespace de staging;
- [ ] canário concorrente ao vivo;
- [ ] rollback ensaiado;
- [ ] runbook operacional;
- [ ] nenhuma regressão no legado.

## Rollback

Antes da ativação de staging, o rollback é apenas a remoção do código e do binding de teste. Depois da ativação, a feature flag será desligada e o binding removido do Worker. O namespace permanecerá inativo para auditoria.

## Critério de saída

A fase termina quando duas operações concorrentes contra o mesmo escopo forem serializadas em staging, somente uma puder prosseguir, holders antigos forem rejeitados por fencing token, o estado sobreviver a eviction e nenhum fluxo real do petshop tiver sido alterado.
