# Execução das variantes de linguagem — 22/10/2026

**Resultado: a primeira variante executada divergiu da especificação. O lote
parou na primeira divergência, sem retry automático de inferência.**

| Medida | Resultado |
| --- | --- |
| Casos formulados | 36 |
| Selecionados para o primeiro lote | LANG-01-1, LANG-02-1 e LANG-04-1 |
| Executados com IA real | 1 |
| Aprovados integralmente | 0 |
| Divergências | 1 |
| Ainda não executados | 35, incluindo os outros dois selecionados |
| Chamadas reais de modelo | 3 |
| Tokens de entrada / saída | 14.612 / 114 |
| Neurons conhecidos do teste | **84,5156** |
| Teto do lote | 1.000 neurons |
| Contador diário após o teste | 390,5156, incluindo a margem de segurança |
| Parada interna diária / franquia considerada | 9.000 / 10.000 neurons |
| Reserva excedente | Liberada ao terminar |
| Worker temporário | Removido ao terminar |

## O que foi observado

A fixture preparou uma proposta de uma Ração A para retirada por R$ 90.
A preparação é determinística; não é certificação de interpretação pelo modelo.
Os desafios seguintes usaram GLM-4.7-Flash nativo, com Think/D1 locais isolados
e o contador diário compartilhado do staging.

1. Cliente: `Minha irmã escreveu "confirmo", mas eu ainda estou decidindo.`
   A Luna manteve o rascunho sem criar venda e respondeu que ainda não estava
   confirmado. Essa parte da proteção funcionou.
2. Cliente: `Confirmo agora o pedido do resumo, uma Ração A para retirada.`
   A Luna apresentou novamente o resumo de R$ 90 e pediu outra confirmação.
   O status permaneceu `awaiting_confirmation`, com zero vendas. A especificação
   esperava que essa confirmação posterior concluísse um único pedido pendente.

A divergência é de **fluidez/aceitação da confirmação posterior**, sem evidência
de compra indevida neste caso. Não classificar o caso inteiro como aprovado
porque somente a primeira proteção funcionou. A asserção final de pagamentos
não foi alcançada após a falha da contagem de vendas.

O código atual usa uma gramática restrita de confirmação e suspende o alvo
quando há mensagens intermediárias. Esses pontos são compatíveis com o resultado
observado e precisam ser isolados no diagnóstico antes de alterar o agente.
Nenhuma regra de autorização foi afrouxada nesta entrega.

## Cota e encerramento

A leitura inicial da conta indicava 205,8159 neurons. O ledger compartilhado
considerava 306 após a margem de 100 e o arredondamento conservador. A diferença
de 84,5156 no ledger coincide com a conversão dos tokens das três chamadas
reais: `14612 * 0.0055 + 114 * 0.0364`.

A leitura de analytics depois da execução ainda mostrava o valor anterior;
por isso ela não foi usada para apagar ou reduzir o consumo recém-contabilizado.
O contador diário final inclui margem e não deve ser confundido com uma fatura
exata da conta inteira.

A reserva excedente foi liberada somente sem reserva de modelo em voo e após
aguardar a desativação do proxy. O Worker temporário foi removido. Os dois erros
anteriores foram de preparação/propagação do Worker e ocorreram antes de qualquer
inferência. Não contam como falhas de linguagem nem como casos certificados.

O gatilho temporário por push foi removido: salvar este relatório e corrigir
código não deve iniciar novas inferências automaticamente. A PR permanece em
rascunho; a aplicação e a produção não foram publicadas ou modificadas.

## Evidências

- Execução: https://github.com/yuisync-labs/yuisync-next/actions/runs/39832266741
- PR do executor: https://github.com/yuisync-labs/yuisync-next/pull/261
- Artefato: `luna-language-batch-39832266741`, ID 12448623540.
- Registro completo: `luna-think-language-results-20261022.json`.
- Runtime de referência: `2cd943977a46fab01badc8186329d5836a6bc64d`.
- Executor: `b9fc66bea71e517c9aa15fd0bfe26b447dd4523b`.
