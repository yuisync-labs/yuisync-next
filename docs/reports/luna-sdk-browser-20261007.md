# Luna — rodada real pelo navegador, 2026-10-07

SHA publicado somente em staging: `fa2ebdaf18d32fe106e746110b3200dec7bf2b2c`.
Rodada: `groq-ui-fa2ebdaf18d3`; Groq `openai/gpt-oss-20b`.

## Resultado real, sem aprovação presumida

Foram digitadas e enviadas pela interface as duas primeiras mensagens do cenário 1.
Não houve reenvio, confirmação comercial ou execução dos cenários 2–20.

| Cenário | Resultado Groq |
|---|---|
| 1 — Compra retirada | REPROVADO no checkpoint após a segunda mensagem; 2/3 turnos executados |
| 2 — Multitem | Não executado |
| 3 — Troca de marca | Não executado |
| 4 — Remoção/quantidade | Não executado |
| 5 — Alternativa | Não executado |
| 6 — Pergunta paralela | Não executado |
| 7 — Pausa/histórico | Não executado |
| 8 — Referências | Não executado |
| 9 — Entrega/endereço | Não executado |
| 10 — Cadastro | Não executado |
| 11 — Multi-intenção | Não executado |
| 12 — Sim informativo | Não executado |
| 13 — Correção de resumo | Não executado |
| 14 — Commit/reenvio | Não executado |
| 15 — Concorrência | Não executado |
| 16 — Agenda | Não executado |
| 17 — Pet/serviço/máquina | Não executado |
| 18 — MotoDog | Não executado |
| 19 — Recuperação/humano | Não executado |
| 20 — Isolamento/injeção | Não executado |

## Transcript e checkpoints

1. Usuário: `Quero uma Ração A.`
   Luna: `Pet cadastrado: luna. / Pet cadastrado: mel. / Pet cadastrado: thor. / Ração A: R$ 90,00; estoque disponível nesta consulta: 10.`
   Ferramentas: bootstrap de identidade, search_products, draft_add_item, finish_turn.
   Carrinho persistido: op1, Ração A × 1. Nenhuma venda, pagamento ou proposta.
   Falha conversacional: informação de pets irrelevante e omissão da pergunta de modalidade.
2. Usuário: `Vou retirar na loja.`
   Luna: `Tudo certo! / Pet cadastrado: luna. / Pet cadastrado: mel. / Pet cadastrado: thor.`
   Ferramentas: bootstrap, draft_add_item redundante (não duplicou a quantidade), draft_set_field com fulfillment_type=pickup, finish_turn.
   Carrinho final: op1, Ração A × 1, fulfillment_type=pickup, versão 2.
   Nenhuma proposta/apresentação/venda/pagamento. O resumo de R$ 90 com retirada não foi apresentado.

## Causas confirmadas no código

- `draft_set_field.value` era string irrestrita e o reducer verificava o nome do campo, não o domínio do valor. Aceitou `pickup`, embora prepare_product_order e capabilities aceitem somente `counter`/`delivery`.
- finish_turn aceitava encerramento comercial sem pergunta material e sem exigir preparação do carrinho completo.
- Fatos do bootstrap eram selecionáveis para uma resposta de compra, produzindo uma listagem factual mas irrelevante.
- O validador de staging verificava apenas ausência de venda no turno 2 do cenário 1, não o resumo/apresentação obrigatórios. `validation.passed=true` não equivaleu a aprovação humana do cenário.

## Consumo confirmado nesta rodada

6 chamadas, 16.834 tokens de entrada + 384 de saída = **17.218 tokens**.
886 leituras D1 totais: 72 runtime, 806 administração, 8 setup.
Reservas pendentes: 0 chamadas, 0 tokens, 0 leituras; incerteza: 0.
Duração: 66.338 ms e 82.470 ms. Não é latência comercial aprovada.
Não inclui consumo das rodadas anteriores, preservadas.

O publicador falhou na checagem imediata de SHA após deploy; uma leitura posterior de `/release` confirmou o SHA e ambiente corretos. Não foi repetido o deploy.

## Estado

Implementado e publicado em staging: refatoração fa2ebda.
Certificado com modelo real: **não**.
Produção publicada por esta rodada: **não**.
Automação de produção / WhatsApp real: **desativados**.
20 offline aprovados eram prova anterior do SHA, não substituem a reprovação real acima.

Evidência visual local: `.artifacts/luna-certification-staging/browser-fa2ebda-scenario1.jpg`.

## Correções posteriores à evidência

- Nova ferramenta plana `draft_set_fulfillment`, enum `counter`/`delivery`, exclusiva do carrinho. A modalidade sai de `draft_set_field`; o comando interno e o carregamento do reducer também recusam valores fora do domínio.
- Encerramento de intenção comercial exige próximo passo material ou proposta nativa da versão atual; informação paralela não força preparação. Identidade de pets não é renderizada numa resposta exclusivamente de compra.
- Checkpoint 1/turno 2 passa a exigir carrinho inalterado, retirada canônica, proposta vigente de R$ 90 e apresentação vinculada.
- Regressão SDK/Worker/D1 reproduz a ausência da pergunta e o encerramento prematuro; valida uma única correção factual, recuperação operacional e apresentação sem venda.

41 testes direcionados em 5 arquivos passaram; typecheck passou após corrigir o predicado de tipo do novo validador. Certificação completa e nova rodada Groq ainda pendentes no momento deste registro. Nenhuma migration ou alteração de dados reais.
