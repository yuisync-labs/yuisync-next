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
- binding local/test e configuração de staging protegida;
- testes no `workerd`;
- teste de eviction e recuperação do estado persistido;
- adapter compatível com `CoordinationPort`;
- feature flag fail-closed;
- canário técnico temporário e autenticado para staging;
- rollback lógico e restauração do staging;
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

## Estado operacional — 2026-08-07

O incidente do GitHub Actions de 6–7 de agosto foi resolvido, mas o GitHub informou que alguns eventos de `push` e `pull_request` perdidos durante o incidente não seriam reprocessados automaticamente. Este commit documental atualiza o plano e gera um novo `synchronize` da PR para obter CI no head atual sem alterar runtime, staging ou produção.

O hardening aplicado durante o incidente permanece:

- `Quality` usa actions v6 e timeouts explícitos;
- reruns não cancelam uma tentativa de recuperação em andamento;
- o rollback legado não dispara mais em todo `pull_request synchronize`;
- rollback permanece manual/protegido;
- deploy, canário e rollback de staging são serializados e enfileirados no grupo `edge-staging-deployment`.

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
- [ ] CI completa do head atual;
- [ ] namespace de staging provisionado;
- [ ] canário concorrente ao vivo;
- [ ] rollback ensaiado;
- [ ] staging restaurado;
- [ ] artefatos temporários removidos;
- [ ] nenhuma regressão no legado no SHA final.

## Rollback

Antes da ativação de staging, o rollback é a remoção do código/binding ou o desligamento da feature flag. Durante o ensaio protegido, o workflow desativa a coordenação, remove o binding do Worker, confirma readiness sem coordenação e restaura a configuração padrão de staging. O namespace pode permanecer inativo para auditoria; produção não participa desta fase.

## Critério de saída

A fase termina quando duas operações concorrentes contra o mesmo escopo forem serializadas em staging, somente uma puder prosseguir, holders antigos forem rejeitados por fencing token, o estado sobreviver a eviction, o rollback/restauração forem comprovados e nenhum fluxo real do petshop tiver sido alterado.
