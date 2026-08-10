# Fase 6 — Coordenação determinística com Durable Objects

## Objetivo

Criar a camada de coordenação stateful da nova arquitetura para impedir operações concorrentes conflitantes por tenant e recurso, sem ativar agendamentos reais.

```text
caso de uso
  -> CoordinationPort
  -> adapter Cloudflare
  -> Durable Object por escopo
  -> claim persistido
  -> fencing token
  -> futura escrita idempotente no D1
  -> futuro evento versionado na Queue
```

## Escopo incluído

- ADR de coordenação determinística;
- porta tipada de claim e conclusão;
- máquina de estados pura com leases;
- fencing tokens crescentes;
- deduplicação por chave idempotente;
- rejeição de holders obsoletos;
- classe Durable Object com SQLite;
- RPC interno;
- binding local/test e configuração permanente de staging;
- testes no `workerd`;
- teste de eviction e recuperação do estado persistido;
- adapter compatível com `CoordinationPort`;
- feature flag fail-closed;
- readiness de coordenação;
- validação ao vivo de concorrência, rollback e restauração;
- hardening de concorrência dos workflows de CI/deploy.

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

O adapter deriva um nome opaco determinístico por SHA-256 sobre a versão e o escopo e resolve o Durable Object com `getByName()`. Identificadores brutos de tenant e recurso não são usados como nome remoto. Nenhuma requisição pode escolher um objeto global compartilhado entre tenants.

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
12. preparar staging e canário protegido;
13. provisionar Durable Object em staging;
14. executar canário concorrente;
15. ensaiar rollback e restaurar staging;
16. remover artefatos temporários;
17. integrar somente com todos os gates verdes.

## Observabilidade

Eventos previstos para a integração de casos de uso:

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

## Validação de staging — 2026-08-07

A validação protegida comprovou a coordenação em staging sem ativar nenhum fluxo real do petshop.

Resultados comprovados:

- a classe `CoordinationDurableObject` com armazenamento SQLite foi provisionada em staging;
- duas claims concorrentes no mesmo escopo produziram exatamente uma `claimed` e uma `busy`;
- a operação vencedora foi concluída com fencing token válido;
- a repetição da mesma chave idempotente retornou estado concluído sem criar nova operação;
- o rollback lógico desligou a coordenação e removeu o binding do Worker;
- `/ready` confirmou `coordination: disabled` durante o rollback;
- a configuração padrão foi restaurada e `/ready` voltou a confirmar `coordination: ready`;
- o segredo efêmero do canário foi removido;
- a rota temporária permaneceu oculta sem autenticação;
- D1 e Queues permaneceram preservados durante o ensaio;
- produção não participou da validação.

A primeira tentativa de deploy encontrou um `503 Service Unavailable` transitório ao reconciliar o consumer da Queue depois de o Durable Object já ter sido criado. A restauração automática do staging passou. O workflow foi endurecido para retry somente em falhas transitórias conhecidas e para usar Worker Secret em vez de variável comum. A segunda execução concluiu integralmente com sucesso.

## Hardening de CI/deploy

- `Quality` usa actions v6 e timeouts explícitos;
- reruns não cancelam uma tentativa de recuperação em andamento;
- o rollback legado não dispara mais em todo `pull_request synchronize`;
- rollback permanece manual/protegido;
- deploy, canário e rollback de staging são serializados e enfileirados no grupo `edge-staging-deployment`;
- operações de deploy fazem retry somente para falhas transitórias identificadas, sem mascarar erros de configuração.

## Gates

- [x] branch criada sobre o merge da PR5;
- [x] ADR-0004 aceito;
- [x] porta de coordenação;
- [x] máquina de estados pura;
- [x] testes de lease, duplicidade e fencing token;
- [x] classe Durable Object SQLite;
- [x] binding local/test;
- [x] RPC interno;
- [x] persistência após eviction;
- [x] adapter da porta;
- [x] feature flag fail-closed;
- [x] configuração de staging preparada;
- [x] tipos Wrangler regenerados;
- [x] hardening de CI/deploy;
- [x] CI completa antes da validação ao vivo;
- [x] Durable Object de staging provisionado;
- [x] canário concorrente ao vivo;
- [x] rollback lógico ensaiado;
- [x] staging restaurado;
- [x] segredo efêmero removido;
- [x] artefatos temporários removidos do código final;
- [ ] CI final do SHA limpo sem regressões.

## Rollback permanente

A feature flag `EDGE_COORDINATION_ENABLED` permanece como corte fail-closed. Um rollback da coordenação pode desligar a flag e remover o binding do Worker sem alterar D1 ou Queues. O namespace pode permanecer inativo para auditoria. Produção continua fora desta fase.

## Critério de saída

A fase termina quando a CI do SHA limpo confirmar que a implementação permanente mantém todos os testes e o legado sem regressões. A serialização concorrente, fencing token, idempotência, rollback e restauração de staging já foram comprovados ao vivo.
