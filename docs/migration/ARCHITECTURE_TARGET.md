# Arquitetura-Alvo

## Direção

O YuiSync Next será inicialmente um **monólito modular Cloudflare-first**, com limites internos fortes e adapters substituíveis. Microserviços só serão considerados quando métricas demonstrarem necessidade operacional real.

## Estrutura pretendida

```text
apps/
  web/                       # React + Vite e assets estáticos
  edge-api/                  # Cloudflare Workers + Hono

packages/
  contracts/                 # Zod schemas, DTOs e eventos versionados
  domain/                    # entidades, value objects e regras puras
  application/               # casos de uso, workflows e ports
  adapters-postgres/         # PostgreSQL/Supabase via Hyperdrive
  adapters-cloudflare/       # D1, R2, Queues, Durable Objects e bindings
  integrations/              # WhatsApp, Focus NFe, OpenAI e outros provedores
  observability/             # logs, traces, métricas e correlação
  testing/                   # fixtures, fakes e cenários compartilhados
```

Esta estrutura é o destino, não uma mudança única. Os primeiros adapters podem envolver o código legado para evitar uma reescrita total.

## Bibliotecas-base planejadas

| Responsabilidade | Escolha inicial | Regra de adoção |
|---|---|---|
| HTTP edge | Hono | introduzir primeiro em um Worker vazio e rotas de baixo risco |
| validação | Zod | contratos novos primeiro; legados recebem adapters de validação |
| acesso tipado a dados | Drizzle | adotar por domínio; não reescrever todas as queries de uma vez |
| testes | Vitest + Playwright | preservar suíte atual e adicionar pool de Workers |
| desenvolvimento/deploy | Wrangler | ambientes separados e bindings tipados |
| observabilidade | OpenTelemetry + Workers Observability | correlation ID obrigatório desde a fundação |

Toda adoção relevante exige ADR. Bibliotecas não podem ser importadas diretamente pelo domínio.

## Mapeamento de infraestrutura

| Necessidade | Estado inicial | Destino provável |
|---|---|---|
| frontend | Vercel/Vite | Workers Static Assets |
| API | Express + serverless + Supabase Functions | Workers + Hono |
| PostgreSQL | Supabase direto | PostgreSQL via Hyperdrive; provedor decidido depois |
| arquivos | Supabase/integrações atuais | R2 |
| tarefas assíncronas | execução síncrona/scripts | Queues com DLQ e idempotência |
| processos longos | lógica espalhada | Workflows |
| coordenação concorrente | banco e leases | Durable Objects quando houver chave natural |
| IA | chamadas diretas | AI Gateway + provider adapters |
| busca semântica | a definir | Vectorize + R2 + metadados persistentes |

## Política de dados

### PostgreSQL permanece inicialmente

Usos preferenciais:

- dados relacionais centrais;
- financeiro e fiscal;
- relatórios globais;
- recursos PostgreSQL já usados;
- schemas ligados a RLS e autenticação durante a transição.

### D1 será seletivo

Possíveis usos:

- configuração operacional isolada;
- idempotency keys;
- checkpoints e projeções simples;
- metadados de ferramentas e avaliações;
- dados naturalmente fragmentáveis por tenant.

D1 não será tratado como substituto automático de PostgreSQL.

### Durable Objects

Possíveis chaves naturais:

- uma conversa ativa;
- uma agenda/recurso;
- um tenant para coordenação específica;
- uma operação longa que exija serialização.

Usos:

- WebSockets;
- confirmação pendente;
- bloqueios temporários;
- prevenção de concorrência em reservas;
- estado curto da conversa.

### R2 e Vectorize

- R2 guarda originais, documentos, imagens e artefatos grandes.
- Vectorize guarda embeddings e filtros de tenant.
- permissões, versões e metadados autoritativos permanecem em banco transacional.

## Fluxo de requisição pretendido

```text
HTTP/Webhook/Queue/WebSocket
            ↓
interface adapter + autenticação
            ↓
validação de contrato + contexto do tenant
            ↓
application use case
            ↓
domain rules
            ↓
ports
            ↓
infrastructure adapters
```

Cada camada deve receber apenas os dados necessários.

## Estado determinístico de agentes

O modelo de linguagem pode:

- classificar intenção;
- extrair entidades;
- escolher entre ferramentas permitidas;
- redigir respostas.

O modelo não pode decidir sozinho:

- se uma reserva foi confirmada;
- se um pagamento foi concluído;
- se um horário está disponível;
- se uma ação deve ser repetida;
- se um efeito irreversível ocorreu.

Exemplo de fluxo controlado:

```text
collecting_data
→ awaiting_summary_confirmation
→ reserving_slot
→ confirmed
```

Transições são validadas pela aplicação e persistidas com versão/concorrência.

## Confiabilidade

### Idempotência

Obrigatória para:

- webhooks;
- consumo de filas;
- checkout;
- emissão fiscal;
- envio de mensagens;
- confirmação de reservas;
- retries de ferramentas da Luna.

### Retries

- apenas em falhas transitórias classificadas;
- backoff limitado;
- deadline total explícito;
- DLQ para mensagens não processáveis;
- sem retry cego de efeitos financeiros.

### Observabilidade mínima

Todo fluxo relevante deve carregar:

- `correlation_id`;
- `tenant_id`;
- `conversation_id` quando aplicável;
- `operation_id` ou idempotency key;
- domínio e caso de uso;
- versão do contrato;
- duração e resultado;
- erro categorizado sem segredos.

## Portabilidade

Bindings e SDKs devem ficar em composition roots/adapters. Exemplos de ports:

```ts
interface AppointmentRepository {}
interface MessageQueue {}
interface ObjectStorage {}
interface LanguageModel {}
interface IdempotencyStore {}
interface Clock {}
```

Essa regra permite trocar Cloudflare, banco ou provedor de IA sem reescrever as regras de negócio.

## Restrições de migração

- nenhum corte simultâneo de runtime, banco e autenticação;
- nenhuma migração de dados sem exportação, reconciliação e rollback testados;
- nenhuma rota é removida antes de shadow/canary e paridade;
- nenhuma refatoração estrutural deve alterar funcionalidade no mesmo PR;
- nenhum domínio novo acessa tabelas de outro domínio diretamente.
