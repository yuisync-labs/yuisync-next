# Baseline do YuiSync Next

## Identificação

| Item | Valor |
|---|---|
| Repositório | `yuisync-labs/yuisync-next` |
| Commit de origem | `e4c2cd063f83318d4828549fd23f8d6888c7f4e6` |
| Tag imutável | `baseline-yuisync-e4c2cd0` |
| Branch de integração | `architecture/cloudflare-foundation` |
| Natureza do ambiente | experimental, sem corte de produção |

## Stack atual observada

- Frontend: React 18, Vite, React Router, Tailwind e bibliotecas de UI/gráficos.
- Backend local: Node.js com Express em `server/index.js`.
- Backend serverless: rotas em `api/`.
- Backend Supabase: funções e migrações em `supabase/`.
- Dados, autenticação e RLS: Supabase/PostgreSQL.
- IA: OpenAI, PetBot e Luna.
- Integrações: WhatsApp Cloud API, Focus NFe e Google Programmable Search.
- Testes: Vitest, Node test runner, Playwright, matrizes do PetBot, avaliações da Luna, testes transacionais e isolamento de tenants.

## Superfícies de execução atuais

A aplicação possui mais de uma forma de executar lógica de backend:

1. `server/index.js` com Express;
2. funções serverless em `api/`;
3. Supabase Functions em `supabase/functions/`;
4. scripts operacionais e de avaliação em `scripts/`;
5. frontend Vite em `src/`.

Esta sobreposição deve ser preservada durante o inventário e reduzida gradualmente nas fases posteriores.

## Pontos de concentração identificados

| Arquivo | Tamanho aproximado | Observação |
|---|---:|---|
| `server/lib/chat.js` | 185 KB | concentração de ingestão, conversação, ferramentas e efeitos |
| `chat-pr4-current.js` | 174 KB | artefato isolado que precisa ser classificado antes de remoção |
| `server/lib/petbotAgent.js` | 111 KB | muitas responsabilidades do fluxo do agente |
| `server/lib/petbotAi.js` | 33 KB | lógica de IA ainda próxima de regras operacionais |
| `server/index.js` | 26 KB | composição, rotas e infraestrutura no mesmo ponto |

Tamanho não é defeito por si só, mas esses arquivos são candidatos prioritários para caracterização por testes e extração incremental.

## Rede de segurança existente

O `package.json` contém gates para:

- typecheck;
- testes unitários;
- PetBot e matrizes de fluxo;
- Luna unitária, regressões e avaliações determinísticas;
- transações e infraestrutura de agenda;
- isolamento de tenant;
- E2E com Playwright;
- build de produção;
- auditoria de dependências.

A workflow `quality.yml` executa a maior parte desses gates em pull requests e mantém testes dependentes de credenciais condicionais.

## Inconsistências conhecidas

1. O README recomenda Node 18+, o `package.json` exige Node 22.x e a CI executa Node 24.
2. A auditoria está bloqueada por uma vulnerabilidade `undici` não incluída na allowlist.
3. Arquivos de redeploy da Vercel e gatilhos de deploy permanecem versionados.
4. O plano antigo em `docs/implementation_plan.md` contém decisões históricas e caminhos locais; ele não será usado como fonte normativa desta migração.
5. A descrição do pacote ainda assume Supabase + OpenAI + React como arquitetura definitiva.
6. Existem scripts SQL em `database/` e `supabase/migrations/`; a autoridade e a ordem completa precisam ser catalogadas antes de qualquer migração de dados.

## Variáveis e integrações críticas

Categorias presentes no `.env.example`:

- frontend público;
- Supabase público e service role;
- modelos e limites OpenAI;
- pesquisa de imagens Google;
- Focus NFe;
- WhatsApp Cloud API e Meta Embedded Signup;
- servidor HTTP e CORS;
- isolamento de tenants;
- credenciais E2E;
- rate limits;
- logging;
- shadow runtime e budgets da Luna;
- serialização do chat do dashboard.

Nenhum segredo real deve ser adicionado ao repositório. A migração deverá mapear cada variável para um binding, secret ou configuração por ambiente.

## Invariantes funcionais

As seguintes propriedades devem permanecer verdadeiras durante toda a migração:

- isolamento de tenant;
- autorização administrativa e por módulo;
- webhooks autenticados e resistentes a replay;
- pedidos de produtos e reservas de serviços com contratos separados;
- confirmação explícita antes de efeitos irreversíveis;
- agenda sem dupla reserva;
- idempotência em checkout, mensagens, webhooks e tarefas assíncronas;
- rastreabilidade por tenant, conversa e operação;
- possibilidade de transferência para atendimento humano;
- fiscal e pagamentos sem duplicação;
- comportamento da Luna coberto por cenários determinísticos.

## Critério de paridade

Uma fase não pode declarar paridade apenas porque compila. Deve demonstrar:

1. mesmos resultados para fixtures e cenários existentes;
2. ausência de novos efeitos duplicados;
3. isolamento entre tenants;
4. logs correlacionáveis;
5. plano de rollback executável;
6. métricas comparáveis entre implementação antiga e nova.
