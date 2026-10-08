# Luna — continuidade pelo navegador, 08/10/2026

## Estado observado

- PR #222, HEAD e staging: `6c408e0003efc63dfa56325c475364d8f1f7e60e`.
- Rodada: `groq-ui-6c408e0003ef`; mesmos checkpoints, sem reinício nem reenvio.
- Cenário 1, primeira mensagem: anteriormente aprovada, resposta factual de Ração A e pergunta sobre retirada/entrega.
- Segunda mensagem previamente enviada: `Vou retirar na loja.`. A restauração retorna `TURN_STATE_UNCERTAIN`, sem evidência final desse turno. Não se confirmou a causa raiz da interrupção.
- Consumo persistido observado: 5 chamadas, 12.725 tokens de entrada, 288 de saída (13.013 total), 68 leituras de runtime, 654 administrativas e 8 de setup (730 total). Reservas e flag de incerteza do orçamento: zero. Isso NÃO comprova que o turno ou seus efeitos terminaram.
- Cenário 1: incompleto/bloqueado. Cenários 2–20: não executados nesta rodada. Zero cenários completos com Groq nesta rodada.
- Nenhuma nova chamada ao modelo foi iniciada nesta continuidade.

## Alteração local

A UI escondia os transcripts e as evidências quando `next` era nulo por bloqueio. Agora o checkpoint inclui metadados do turno bloqueado, e a tela mantém as respostas previamente concluídas visíveis. A ausência de evidência não autoriza reenvio, avanço, alteração de orçamento ou aprovação.

Arquivos: `scripts/luna/browserCheckpoint.ts` (novo), `scripts/luna/stagingWorker.ts`, `scripts/luna/certificationPlayground.ts`, `apps/edge-api/test/lunaBrowserCheckpoint.test.ts` (novo).

## Validação local

- Testes direcionados Worker/D1: 16/16, dois arquivos (novo checkpoint + adaptador de certificação), 19,50 s.
- Typecheck do Worker: aprovado.
- `git diff --check`: aprovado, avisos somente de normalização CRLF.
- A primeira execução dentro do sandbox não iniciou o runtime (`cloudflare:test-internal`, EPERM de logs); não foi contada como aprovação. A execução seguinte com permissão de runtime e logs no workspace passou.
- Não foi repetida a regressão completa neste turno: o relatório anterior registra gates verdes para o HEAD congelado, não para essas novas alterações locais.

## Acesso e liberação

A consulta remota Wrangler ao banco isolado foi recusada com código Cloudflare 7403. O painel exigiu novo login; a sessão de navegador foi restaurada pela conta Google já salva. A autorização CLI não foi alterada ou considerada restaurada por isso.

Após `wrangler whoami` confirmar conta e escopo D1, uma única repetição da consulta de diagnóstico funcionou: duas linhas (turno 0 `complete`, turno 1 `running`), 24 leituras D1, zero escritas. Não foi necessário recriar credenciais. O aviso de escopos K2 ausentes não foi tratado como motivo para aumentar permissões.

Duas consultas somente leitura no Console do banco isolado confirmaram:

- Estado `op-1`, versão 2, cart ativo, `fulfillment_type=counter`, Ração A ×1.
- Zero vendas e zero pagamentos desse tenant fictício.
- Últimas ferramentas do turno: bootstrap `get_customer_context` e `draft_set_fulfillment`, ambas `succeeded`; nenhuma preparação/resumo final registrado nesse turno.

As consultas manuais no Console não passam pelo contador da rodada: suas métricas de leituras não foram expostas pela UI, portanto não são apresentadas como zero. As 730 leituras são o contador persistido da execução, não o total de toda a investigação. A consulta CLI adicional tem 24 leituras medidas. Não se certifica o orçamento completo da investigação sem esses metadados adicionais.

Hipótese a verificar: interrupção da requisição HTTP durante a espera de quota, pois o endpoint mantém a execução dentro da requisição, registra o lock `running` antes das ferramentas e só grava a evidência no fim. Não há checkpoint durável de cada chamada ao modelo nesse adaptador. Os registros comprovam execução parcial, mas não distinguem desconexão, cancelamento da plataforma ou outra falha fatal; não se apresenta a hipótese como causa raiz confirmada.

Código de diagnóstico implementado e validado em testes direcionados, ainda não commitado/publicado. Certificação real incompleta. Nenhum merge, deploy ou ativação de produção; WhatsApp real e automação permanecem fora de escopo.
