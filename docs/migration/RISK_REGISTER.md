# Registro de Riscos

Escalas:

- Probabilidade: baixa, média, alta.
- Impacto: baixo, médio, alto, crítico.
- Estado: aberto, mitigando, aceito, resolvido.

| ID | Risco | Prob. | Impacto | Evidência/sinal | Mitigação principal | Gatilho de rollback | Estado |
|---|---|---|---|---|---|---|---|
| R-001 | Migrar código acoplado sem compreender efeitos | alta | crítico | múltiplos runtimes e arquivos centrais grandes | testes de caracterização, mapa de domínio, extração incremental | divergência funcional não explicada | mitigando |
| R-002 | Misturar pedido de produto e reserva de serviço novamente | média | alto | histórico de contrato genérico e correções do PetBot | schemas distintos, casos de uso distintos e testes de matriz | payload ou pergunta de produto aparecendo em serviço | mitigando |
| R-003 | Dupla reserva de agenda | média | crítico | confirmação e disponibilidade atravessam agente, banco e chat | autoridade única de scheduling, versionamento e coordenação serializada | conflito ou duas confirmações para o mesmo recurso/slot | aberto |
| R-004 | Duplicação por filas/webhooks/retries | alta | crítico | canais externos e execução at-least-once | idempotency key, inbox/outbox, DLQ e testes de replay | duplicação financeira, fiscal, pedido ou mensagem | aberto |
| R-005 | Quebra por incompatibilidade Node/Workers | alta | alto | Node 18 no README, 22 em engines, 24 na CI; APIs Node parciais no edge | alinhar versão, inventariar APIs e testar no runtime real | import/runtime error no Worker | aberto |
| R-006 | Vulnerabilidades bloquearem ou serem ignoradas | alta | alto | auditoria atual bloqueada por `undici`; allowlist temporária existente | corrigir dependências em PR dedicado, política de expiração | advisory high sem correção/aceite válido | aberto |
| R-007 | Migração prematura de PostgreSQL para D1 | média | crítico | SQL, RLS, functions, triggers e consultas ainda não inventariados | Postgres via Hyperdrive primeiro; D1 seletivo por ADR | perda de semântica, performance ou integridade | aberto |
| R-008 | Falha de isolamento entre tenants | média | crítico | RLS, service role e testes condicionados a credenciais | contexto obrigatório, testes de isolamento e revisão de policies | leitura/escrita cross-tenant | aberto |
| R-009 | Segredos expostos em frontend, logs ou commits | média | crítico | muitas integrações e variáveis server-only | secret scanning, bindings, redaction e revisão de env | segredo detectado em bundle/log/repo | aberto |
| R-010 | Mudança de autenticação quebrar sessões/RLS | média | crítico | Supabase Auth ligado a JWT, refresh e policies | autenticação por último, paridade e revogação testadas | aumento de 401/403 ou acesso indevido | aberto |
| R-011 | Luna/PetBot gerar efeitos não determinísticos | alta | alto | agentes próximos de ferramentas e regras operacionais | state machine, tool registry tipado, confirmação e idempotência | efeito sem transição válida ou confirmação | mitigando |
| R-012 | Observabilidade insuficiente para comparar runtimes | alta | alto | logs atuais não são ainda contrato transversal | correlation IDs, traces, métricas e erro categorizado | divergência sem rastreabilidade | aberto |
| R-013 | CI lenta ou flakey atrasar a migração | média | médio | suíte extensa com cenários e testes condicionais | medir, paralelizar por categoria e quarentena explícita | falhas não reproduzíveis recorrentes | aberto |
| R-014 | Dual-write produzir divergência silenciosa | média | crítico | poderá ser necessário em migração de dados | janela curta, outbox, checksums e reconciliação | diferença acima do limite ou backlog crescente | aberto |
| R-015 | Custos/limites Cloudflare inesperados | média | alto | Queues, Workflows, DO, Vectorize e AI Gateway têm perfis distintos | budgets, métricas por tenant, testes de carga e limites | custo/uso acima do orçamento definido | aberto |
| R-016 | Dependência excessiva do fornecedor | média | médio | adoção ampla de bindings Cloudflare | ports/adapters e contratos de domínio independentes | regra de negócio importando binding/SDK | mitigando |
| R-017 | Artefatos legados serem removidos antes de classificação | média | médio | arquivos de redeploy, scripts e `chat-pr4-current.js` | classificar uso, histórico e substituto antes de remover | referência encontrada após remoção | aberto |
| R-018 | Alterações de schema sem ordem/autoria definida | alta | crítico | migrations em `database/` e `supabase/migrations/` | catálogo de migrations, checksum e fonte canônica | migration não reproduzível ou fora de ordem | aberto |

## Regras de manutenção

1. Todo PR de fase revisa os riscos afetados.
2. Risco crítico aberto exige mitigação explícita antes de cutover.
3. Um risco só é resolvido com evidência verificável.
4. Novos riscos recebem ID estável; IDs não são reutilizados.
5. Exceções temporárias devem conter responsável e data de revisão.

## Critérios de interrupção imediata

A migração deve parar e retornar ao caminho anterior diante de:

- acesso cross-tenant;
- duplicação financeira, fiscal ou de agenda;
- perda ou corrupção de dados;
- exposição de segredo;
- incapacidade de rastrear uma operação crítica;
- aumento sustentado de erro sem causa conhecida;
- divergência entre legado e novo runtime acima do limite aprovado.
