# Plano de Migração e Implementação

## Estratégia geral

A migração será incremental e reversível:

```text
inventariar
→ estabilizar
→ modularizar
→ introduzir Cloudflare em paralelo
→ migrar rotas e efeitos
→ modernizar Luna/PetBot
→ migrar dados e autenticação por domínio
→ realizar cutover controlado
```

Cada fase tem gates de entrada e saída. Uma fase bloqueada não é contornada com exceções silenciosas.

## Fase 0 — Inventário e governança

### Entregas

- baseline reproduzível;
- mapa de domínios;
- arquitetura-alvo;
- plano por fases;
- registro de riscos;
- processo de ADR.

### Não inclui

- novas dependências;
- alteração de runtime;
- mudança funcional;
- alteração de banco;
- deploy Cloudflare.

### Gate de saída

- documentos revisados;
- riscos críticos reconhecidos;
- invariantes aceitos;
- PR0 verde ou falhando apenas por problemas de baseline explicitamente registrados.

## Fase 1 — Safety net e higiene técnica

### Objetivos

- alinhar Node local, `engines`, README e CI;
- corrigir o bloqueio de `undici` sem allowlist permanente indevida;
- definir scripts canônicos de qualidade;
- separar testes obrigatórios dos testes dependentes de credenciais;
- medir duração e flakiness da suíte;
- criar checagem de segredos e configuração.

### Mudanças previstas

- atualização controlada de dependências;
- matriz de CI por tipo de teste;
- relatório de cobertura para módulos críticos;
- testes de caracterização dos hotspots;
- convenção de erros e correlation IDs.

### Gate de saída

- instalação reproduzível;
- audit sem vulnerabilidade high não justificada;
- typecheck, testes e build verdes;
- nenhuma credencial real exigida para testes básicos;
- tempo e taxa de falha da CI registrados.

### Rollback

Reverter o PR da fase. Não há alteração de infraestrutura nem schema.

## Fase 2 — Contratos e limites de domínio

### Objetivos

- introduzir Zod e contratos versionados;
- criar erros tipados;
- separar produto de serviço de forma estrutural;
- criar ports sem mudar provedores;
- envolver o legado com adapters.

### Primeiros contratos

- contexto de tenant;
- mensagem recebida;
- pedido de produto;
- reserva de serviço;
- confirmação/cancelamento;
- resultado de ferramenta;
- evento de domínio e envelope de fila.

### Gate de saída

- contratos testados;
- imports de infraestrutura proibidos nas novas pastas de domínio;
- comportamento do baseline preservado;
- matrizes PetBot/Luna sem regressão.

### Rollback

Feature flags/adapters retornam ao caminho legado; contratos permanecem sem controlar tráfego.

## Fase 3 — Fundação Cloudflare

### Objetivos

- criar `apps/edge-api` com Workers + Hono;
- configurar Wrangler para local, test e staging;
- adicionar bindings tipados e secrets por ambiente;
- configurar observabilidade e health endpoints;
- adicionar testes com `@cloudflare/vitest-pool-workers`.

### Restrições

- sem dados reais;
- sem substituir rotas produtivas;
- sem D1 como banco central;
- sem remover Express/Vercel.

### Gate de saída

- deploy de staging reproduzível;
- health/readiness e logs correlacionados;
- testes reais do runtime Workers;
- rollback por versão do Worker validado.

## Fase 4 — Migração de runtime e rotas

### Estratégia

Migrar por fatias verticais, começando por rotas de leitura e menor risco:

1. health/configuração pública segura;
2. leitura de catálogo;
3. endpoints administrativos de homologação;
4. ingestão de mensagens;
5. agendamento e checkout;
6. fiscal e operações críticas por último.

PostgreSQL permanece acessível via Hyperdrive/adapters.

### Técnicas

- shadow requests para operações de leitura;
- comparação de resposta antiga/nova;
- canary por tenant ou feature flag;
- timeout e fallback explícitos;
- métricas de erro, p95 e consistência.

### Gate por rota

- contrato idêntico ou versionado;
- testes unitários, integração e runtime;
- comparação em shadow sem divergência crítica;
- rollback em configuração, sem novo deploy de código quando possível.

## Fase 5 — Assíncrono, storage e concorrência

### Cloudflare Queues

- envelopes versionados;
- at-least-once assumido;
- idempotency key obrigatória;
- retries limitados;
- DLQ e replay manual auditado.

### Workflows

Candidatos:

- preparação e confirmação de reserva;
- emissão fiscal;
- importações;
- onboarding de tenant;
- tarefas longas da Luna.

### Durable Objects

Candidatos:

- conversa ativa;
- serialização de reserva por agenda/recurso;
- confirmação pendente;
- WebSocket e presença.

### R2

Candidatos:

- imagens de produtos;
- documentos;
- anexos;
- fixtures e artefatos grandes de avaliação.

### Gate de saída

- testes de duplicação, retry, timeout e DLQ;
- recuperação após falha demonstrada;
- nenhuma dupla reserva ou duplo efeito em cenários concorrentes.

## Fase 6 — Luna e PetBot

### Objetivos

- separar interpretação, planejamento, execução e renderização;
- registrar ferramentas em registry tipado;
- persistir estado determinístico;
- usar AI Gateway através de adapter;
- preparar Vectorize/R2 para conhecimento por tenant;
- manter avaliações e trace replay como gate.

### Máquina de estado

A aplicação controla transições, confirmação e efeitos. O modelo apenas propõe intenção/dados/ferramentas dentro do contrato.

### Gate de saída

- avaliações determinísticas sem regressão relevante;
- orçamento de ferramentas, tokens, tempo e retries aplicado;
- ferramentas idempotentes;
- handoff humano preservado;
- body logging de prompts desabilitável por ambiente/tenant.

## Fase 7 — Dados e autenticação

### Banco

Migrar por domínio, não por servidor inteiro:

1. inventário de tabelas, funções, triggers, policies e extensões;
2. definição da autoridade de migrations;
3. exportação e checksums;
4. dual-read ou dual-write apenas quando necessário e temporário;
5. reconciliação automática;
6. cutover por domínio;
7. janela de rollback;
8. remoção posterior do caminho legado.

D1 só será escolhido para dados compatíveis com suas características. PostgreSQL continua para dados relacionais e transacionais complexos.

### Autenticação

- separar painel interno de autenticação de clientes finais;
- documentar JWT, refresh, providers, RLS e service role atuais;
- testar revogação, expiração e isolamento;
- não substituir Supabase Auth antes de haver paridade verificável.

### Gate de saída

- restore testado;
- reconciliação sem divergência crítica;
- autorização e tenant isolation aprovados;
- rollback de dados documentado e ensaiado.

## Fase 8 — Cutover e desativação

### Etapas

- shadow traffic;
- canary interno;
- canary por tenants de teste;
- aumento gradual de tráfego;
- congelamento temporário de mudanças incompatíveis;
- período de observação;
- desativação gradual do legado;
- retenção de exportações e runbooks.

### Critérios finais

- disponibilidade e erro dentro do SLO;
- p95 igual ou melhor que o baseline;
- zero incidentes de isolamento de tenant;
- zero duplicações financeiras/fiscais;
- rollback executado em ensaio;
- custos e limites conhecidos;
- documentação operacional atualizada.

## Formato obrigatório de PR por fase

Cada PR deve incluir:

- problema e escopo;
- arquivos/domínios afetados;
- contratos alterados;
- testes executados;
- métricas antes/depois quando aplicável;
- riscos;
- feature flag;
- plano de deploy;
- plano de rollback;
- ADR relacionado.

## Regra de tamanho

Um PR não deve misturar mais de uma destas categorias:

- refatoração estrutural;
- mudança funcional;
- alteração de schema/dados;
- troca de infraestrutura;
- atualização ampla de dependências.

Quando duas categorias forem inseparáveis, a exceção deve ser explicada em ADR e acompanhada por testes de caracterização.
