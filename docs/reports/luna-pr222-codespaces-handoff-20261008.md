# Luna PR #222 — continuidade remota, 08/10/2026

## Escopo deste envio

Checkpoint de desenvolvimento na branch `codex/luna-operational-foundation`, a partir de `6c408e0003efc63dfa56325c475364d8f1f7e60e`. Este envio não é uma release certificada. Não autoriza merge, deploy de produção, WhatsApp real ou ativação de automação.

Inclui diário D1 de chamadas/ferramentas, fila durável no Durable Object existente, retomada por alarm, estados de execução, playground assíncrono com GroqSdkProvider, preservação das evidências bloqueadas e certificação dividida em cinco blocos fixos. A migration `0045_luna_durable_turn_journal.sql` é aditiva e ainda não foi aplicada remotamente nesta continuidade.

Mudanças locais não relacionadas em importadores do legado e relatórios de dados não fazem parte deste checkpoint. Nenhum backup, credencial, arquivo `.env` ou dado operacional bruto deve ser transferido ao Codespaces.

## Evidência do incidente anterior

Evento Cloudflare de 07/10/2026, 17:58:55.590 (America/Sao_Paulo): endpoint de certificação teve outcome `canceled`, wallTimeMs 21885 e cpuTimeMs 88. Isso confirma cancelamento da execução vinculada à requisição; não comprova que ocorreu durante espera de quota. Não houve estouro de CPU nesse evento.

A rodada antiga `groq-ui-6c408e0003ef` continua preservada/bloqueada: cenário 1 parcial, 2–20 não executados, 0/20 cenários reais completos. Nenhuma nova chamada real ao Groq foi feita neste envio. Não liberar o lock nem reenviar aquela mensagem.

## Validações deste checkpoint

- Typecheck Worker aprovado.
- Suíte direcionada de sete arquivos: 21 testes passaram; um teste de retomada no DO excedeu 20 segundos na execução conjunta. Essa execução não foi aprovada integralmente.
- Reexecução isolada do arquivo `lunaCertificationDurableExecution.test.ts`: 2/2 testes passaram; duração do teste de retomada 1,13 s, duração do runner 8,82 s. Manter o timeout inicial registrado; confirmar estabilidade em Linux e na regressão completa.
- Polling frontend: 3/3 testes passaram.
- Typecheck frontend aprovado.
- Os 20 cenários offline no código final, a regressão completa e os 20 com Groq ainda precisam ser executados; evidências verdes do SHA anterior não certificam este checkpoint.

## Continuar em Linux / Codespaces

1. Usar esta branch, não `main`. Confirmar o SHA com `git rev-parse HEAD`.
2. Usar Node 22, conforme `.nvmrc` / `engines`. No container padrão com nvm: `nvm install 22` e `nvm use 22`.
3. Executar `npm ci`, sem copiar secrets locais.
4. Executar os testes novos: `npm exec --workspace @yuisync/edge-api -- vitest run --config vitest.config.ts test/lunaTurnJournal.test.ts test/lunaDurableTurnQueue.test.ts test/lunaDurableSdkRecovery.test.ts test/lunaCertificationDurableExecution.test.ts test/lunaBrowserCheckpoint.test.ts`.
5. Confirmar integração das sessões auxiliares de concorrência (`test/fixtures/luna/peerRuntime.ts`) com o diário; não considerar só os testes unitários como aprovação dos roteiros.
6. Executar os 12 arquivos `test/lunaDesigned*.test.ts` via Vitest Worker: 20 cenários obrigatórios + variações controladas. Registrar resultados individuais, checkpoints e violações.
7. Corrigir falhas sem mudar os critérios; finalizar os testes de segurança/retomada do playground normal, recuperação visual após recarga, validação do identificador de job e métricas de latência/consumo.
8. Executar `npm run test:all` uma vez na integração final e gerar novos gates vinculados ao SHA final. Não reutilizar `.artifacts` do PC nem gates de `6c408e0`.
9. Publicar somente em staging após todos os gates locais; Groq real somente pelo navegador lateral no YuiSync, em cinco blocos de quatro cenários, nos orçamentos aprovados. Não executar o runner CLI de modelo real.
10. Sem merge/deploy/ativação em produção. Relatório deve distinguir implementado, certificado, publicado e habilitado.

Codespaces é apenas o ambiente de execução dos testes/código; não altera o runtime Cloudflare/D1 da Luna. Repositório público não concede Codespaces ilimitado. Verificar a franquia e orçamento com bloqueio de excedentes antes de iniciar; preferir uma máquina de 2 cores e suspender quando não utilizada. O login Git para push não equivale ao escopo `codespace` do GitHub CLI.
