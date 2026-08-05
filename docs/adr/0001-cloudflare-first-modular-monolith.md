# ADR-0001: Cloudflare-first com monólito modular e migração incremental

- Status: proposed
- Data: 2026-08-05
- Decisores: mantenedores do YuiSync Next
- Domínios afetados: todos
- Riscos relacionados: R-001, R-005, R-007, R-010, R-016
- PRs relacionados: PR0

## Contexto

O YuiSync atual combina frontend Vite, servidor Express, APIs serverless, Supabase Functions, PostgreSQL/Supabase e integrações externas. Regras de negócio, estado conversacional e infraestrutura ainda se cruzam em arquivos grandes.

O objetivo é melhorar desempenho, escalabilidade e manutenção sem reproduzir a turbulência atual em uma nova plataforma e sem realizar uma reescrita total.

## Restrições

- o YuiSync atual deve permanecer intacto;
- a nova implementação é inicialmente um ambiente de testes;
- isolamento de tenant e efeitos críticos não podem regredir;
- a migração precisa permitir rollback por etapa;
- PostgreSQL, RLS e autenticação não podem ser substituídos sem inventário e paridade;
- regras de negócio devem permanecer portáveis.

## Opções consideradas

### A. Reescrita Cloudflare-only imediata

Mover frontend, API, banco, autenticação, filas, IA e storage de uma vez.

Benefício: arquitetura final alcançada rapidamente no papel.

Riscos: perda de paridade, migração de dados complexa, falhas difíceis de isolar e rollback amplo.

### B. Microserviços desde o início

Separar cada domínio em um Worker/serviço próprio.

Benefício: isolamento físico.

Riscos: contratos distribuídos prematuros, maior custo operacional, tracing mais complexo e dificuldade para equipe pequena.

### C. Monólito modular Cloudflare-first e migração incremental

Criar limites internos por domínio, ports/adapters e um Worker/Hono como novo runtime. Manter PostgreSQL inicialmente via adapter/Hyperdrive e adotar serviços Cloudflare apenas quando houver responsabilidade clara.

Benefício: evolução reversível, menor risco e possibilidade de extração futura baseada em métricas.

### D. Manter a arquitetura atual

Evita custo inicial, mas preserva sobreposição de runtimes, acoplamentos e ciclo de microcorreções.

## Decisão

Adotar a opção C.

O YuiSync Next será um monólito modular no início. Cloudflare será a plataforma prioritária para runtime e serviços de borda, mas as regras de negócio serão independentes dos bindings.

Ordem principal:

1. inventário e safety net;
2. contratos e limites de domínio;
3. Worker/Hono em staging;
4. migração gradual de rotas;
5. Queues, Workflows, Durable Objects e R2 por caso de uso;
6. modernização da Luna/PetBot;
7. dados e autenticação por último.

## Consequências positivas

- reduz risco de big bang;
- mantém rollback por rota/domínio;
- permite comparar legado e novo runtime;
- evita microserviços prematuros;
- melhora portabilidade por ports/adapters;
- permite escalar componentes específicos posteriormente.

## Consequências negativas

- haverá coexistência temporária de duas arquiteturas;
- adapters e feature flags aumentam código durante a transição;
- parte dos ganhos de simplificação só aparece após fases posteriores;
- exige disciplina para não importar bindings diretamente no domínio.

## Impacto de segurança e tenant

- contexto de tenant será obrigatório em casos de uso e logs;
- secrets ficam em bindings/secret stores, nunca em domínio ou frontend;
- service role permanece server-only;
- rotas migradas precisam repetir ou melhorar autenticação e autorização atuais;
- testes de isolamento são gate de fases críticas.

## Plano de implementação

Seguir `docs/migration/MIGRATION_PLAN.md`, com uma branch e PR por fase. Toda adoção de biblioteca ou serviço estrutural recebe ADR específico.

## Plano de rollback

- rotas novas são controladas por feature flags/canary;
- PostgreSQL permanece autoridade inicial;
- runtimes antigos não são removidos antes da paridade;
- cada fase pode ser revertida sem mover a branch de baseline;
- alterações de dados exigem backup, reconciliação e janela de rollback.

## Evidências exigidas

- testes de caracterização;
- CI verde;
- métricas de erro e latência comparáveis;
- testes no runtime real de Workers;
- testes de concorrência e idempotência;
- ensaio de rollback antes do cutover.

## Revisão futura

Reavaliar a necessidade de microserviços quando houver dados de carga, ownership independente, ciclos de deploy conflitantes ou limites concretos do monólito modular.
