# PR #222 — implementação e cenários: relatório parcial

Esta rodada não conclui a certificação prevista. Nenhum merge, push, deploy,
ativação ou acesso ao Supabase foi realizado. Dados reais não foram alterados.

## Incremento sobre o estado anterior

- Cadastro de cliente/pet novo e de pet adicional: schemas fechados, telefone
  obtido da conversa, proposta sem escrita prematura, confirmação vinculada ao
  resumo, recibo transacional e recuperação idempotente. Cadastros ambíguos não
  são unidos. Cliente API e agente compartilham o comando nativo de inserção.
- Entrega: endereço estruturado, cobertura/taxa configurada, snapshot do
  endereço e da cobertura, resumo com taxa/total e revalidação no commit.
  O guard D1 revalida o snapshot dentro da transação; alteração exige nova
  proposta. Retirada não reutiliza taxa/endereço de entrega na venda.
- Estoque: reserva na mesma transação do pedido pendente, usando a coluna
  nativa `reserved_milliunits`. Guard de preço/disponibilidade fecha a corrida
  entre consulta e escrita. Cancelamento/deleção liberam a reserva. Não há
  pagamento nem baixa física fictícia.
- Resposta/resultado: cadastro confirmado tem renderer factual; propostas
  invalidadas durante o próprio turno não são anunciadas como aguardando
  confirmação nem retornadas como resumos apresentados.
- Novos adaptadores de cenários executam mensagens exatas, ferramentas,
  snapshots de estado, apresentação e invariantes no Worker/D1 local.

## Arquivos desta rodada

Migrations aditivas, ainda não aplicadas em staging/produção:

- `apps/edge-api/migrations/0038_luna_registration_receipts.sql`
- `apps/edge-api/migrations/0039_pending_order_stock_reservations.sql`
- `apps/edge-api/migrations/0040_sale_delivery_addresses.sql`

Comandos nativos novos:

- `apps/edge-api/src/clientRegistrationCommand.ts`
- `apps/edge-api/src/pendingOrderStockReservation.ts`
- `apps/edge-api/src/saleDeliveryAddress.ts`

Integração:

- `apps/edge-api/src/petshopClientsApi.ts`
- `apps/edge-api/src/luna/registrationCommands.ts`
- `apps/edge-api/src/luna/deliveryContract.ts`
- `apps/edge-api/src/luna/toolRegistry.ts`
- `apps/edge-api/src/luna/commitProposal.ts`
- `apps/edge-api/src/luna/informationTools.ts`
- `apps/edge-api/src/luna/operationalState.ts`
- `apps/edge-api/src/luna/proposalPresentation.ts`
- `apps/edge-api/src/luna/factualResponse.ts`
- `apps/edge-api/src/luna/runLunaTurn.ts`

Testes novos:

- `apps/edge-api/test/lunaRegistration.test.ts`
- `apps/edge-api/test/lunaDeliveryCommit.test.ts`
- `apps/edge-api/test/pendingOrderStockReservation.test.ts`
- `apps/edge-api/test/lunaDesignedCartScenarios.test.ts`
- `apps/edge-api/test/lunaDesignedRegistrationScenario.test.ts`
- `apps/edge-api/test/lunaDesignedSafetyScenarios.test.ts`

Testes/fixtures ajustados:

- `apps/edge-api/test/lunaRecovery.test.ts`
- `apps/edge-api/test/lunaInformationTools.test.ts`
- `apps/edge-api/test/d1ColdUpgradeV25Harness.ts`
- `apps/edge-api/test/d1MigrationUpgradeMatrix.test.ts`

## Resultado individual dos 20 cenários

“Aprovado offline” significa integração com provedor **simulado**, Worker real
e D1 local. Não comprova compreensão/naturalidade pelo Groq. Não foram criados
20 chats aleatórios, nem substituídos checkpoints por testes unitários.

| Nº | Cenário | Offline | Groq real |
|---:|---|---|---|
| 1 | Compra retirada pendente | Aprovado | Não executado |
| 2 | Carrinho multitem | Aprovado | Não executado |
| 3 | Troca de marca | Aprovado | Não executado |
| 4 | Remoção/quantidade | Aprovado | Não executado |
| 5 | Indisponibilidade/alternativa | Não executado | Não executado |
| 6 | Pergunta paralela loja/entrega | Aprovado | Não executado |
| 7 | Pausa/histórico longo | Aprovado | Não executado |
| 8 | Referências/ambiguidade | Não executado | Não executado |
| 9 | Endereço corrigido/retirada | Aprovado | Não executado |
| 10 | Cadastro novo confirmado | Aprovado | Não executado |
| 11 | Banho/compra independentes | Não executado | Não executado |
| 12 | Sim informativo | Aprovado | Não executado |
| 13 | Correção após resumo | Aprovado | Não executado |
| 14 | Commit/reenvio ambíguos | Não executado | Não executado |
| 15 | Concorrência financeira | Não executado | Não executado |
| 16 | Datas/reagendamento/cancelamento | Não executado | Não executado |
| 17 | Pet/serviço/número da máquina | Não executado | Não executado |
| 18 | MotoDog/modalidade | Não executado | Não executado |
| 19 | Falha/humano/risco clínico | Não executado | Não executado |
| 20 | Injeção/isolamento | Aprovado | Não executado |

Total: **11/20 offline; 0/20 Groq**. As provas pontuais de recuperação,
estoque/concorrência e horários não aprovam, por associação, os roteiros
14–19 que ainda não foram executados integralmente.

## Testes e gates

- Rodada consolidada incluindo o ajuste de apresentação: **89/89 testes,
  18 arquivos**, incluindo os 11 cenários e regressões afetadas.
- Upgrade frio v25: **2/2**; matriz v25–v29: aprovada na rodada consolidada.
- Typecheck Worker, typecheck dos contratos e verificação de fronteiras:
  aprovados nesta rodada.
- `test:luna`, `test:petbot`, suíte Worker inteira, contratos completos,
  typecheck global, build e `test:all`: **não executados nesta integração**.
  Os comandos focados acima não substituem esses gates.
- Rodada real e revisão dos 20 transcripts: **não iniciadas**, porque o gate
  dos 20 offline ainda está incompleto.

## Falhas encontradas e corrigidas

1. Fixture de cadastro encaminhava campos extras da resposta para o contrato
   de commit. O servidor rejeitou; corrigida a seleção de ID/versão no teste.
2. Upgrade removia a tabela de reservas mantendo um trigger em `sales` que a
   referenciava. Corrigida a ordem de remoção no fixture, sem alterar migrations
   anteriores. Upgrade reexecutado e aprovado.
3. Pedido pendente tinha uma janela de oversell entre leitura e batch. Adicionada
   reserva nativa atomicamente; teste disputa a última unidade e verifica rollback,
   liberação e ausência de pagamento/baixa física.
4. Resultado do turno usava o número de propostas preparadas, mesmo quando já
   invalidadas. Agora usa apenas resumos realmente vigentes incorporados à resposta.

## Consumo

- Groq real: **0 chamadas; 0 tokens**.
- Leituras D1 staging/produção desta rodada: **0**; nenhum teste remoto.
- Leituras D1 locais: não instrumentadas globalmente nesta rodada; não há
  alegação de um total medido. Os valores de uso do provedor simulado não são
  consumo real de LLM.
- Nenhuma mensagem enviada ao WhatsApp; nenhum agente auxiliar criado.

## Bloqueios e dívida restante

1. Concluir commit nativo do MotoDog, endereço/modalidade e revalidação de suas
   regras, sem prometer capacidade inexistente. A consulta do catálogo já existe,
   mas não substitui preparação/reserva/commit completo.
2. Persistir/revalidar o número da tosa na máquina no comando nativo, sem pedi-lo
   para tesoura; fechar o guard de concorrência da agenda dentro do batch D1.
3. Integrar a liquidação da reserva de pedidos ao fluxo nativo de pagamento/
   conclusão, além da liberação por cancelamento já implementada. Reserva não
   autoriza cobrar ou marcar pedido pago automaticamente.
4. Finalizar memória de opções apresentadas/pergunta pendente, resumo atualizável
   e decisão estruturada multi-intenção. Os drafts independentes já persistem,
   mas isso não completa o contrato de memória conversacional do plano.
5. Evoluir a linguagem factual além das aberturas/perguntas conservadoras atuais,
   preservando a fonte dos fatos. A naturalidade ainda não está certificada.
6. Completar adaptadores/checkpoints/falhas dos nove cenários restantes e o
   runner real retomável com medição dos três orçamentos. Só então executar
   Groq em staging isolado, revisar transcripts e rodar a regressão final.

## Estado de entrega

- **Código implementado:** incremento local parcial, não todo o planejamento.
- **Código certificado:** testes focados e 11 cenários offline; certificação
  integral bloqueada, sem aprovação de release.
- **Código publicado:** não; nenhum merge/push/deploy nesta rodada.
- **Automação habilitada:** não; nenhuma ativação de produção/WhatsApp real.

Alterações locais preexistentes de migração/Quatro Patas foram preservadas e
não fazem parte deste incremento.
