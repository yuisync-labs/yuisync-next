# Certificação real da Luna — contrato de execução

O orquestrador `scripts/luna/realCertificationRunner.mjs` não faz deploy,
não ativa WhatsApp, não importa o backend Node e não é incluído no build.
Os seis testes em `test/luna/realCertificationRunner.test.mjs` usam um adaptador
simulado: eles **não** representam os vinte cenários com Groq real.

## Pré-condições obrigatórias

- Vinte roteiros offline aprovados no SHA informado e gates completos verdes.
- `offline.manifestHash` igual a `certificationManifestHash(scenarios)`, usando
  os roteiros versionados em `apps/edge-api/test/fixtures/luna/designedScenarios.ts`.
- Adaptador nativo em staging isolado, mesmo SHA, somente fixtures e sem WhatsApp.
- Store durável com compare-and-swap; nunca reutilizar checkpoint de outro SHA,
  manifesto ou rodada, nem zerar contadores para continuar uma rodada esgotada.
- Credencial Groq somente no ambiente do Worker, mantendo o modelo configurado.

## Adaptador exigido, sem aprovação por ausência

`adapter.bound({scenario,turn,checkpoint})` devolve tetos verificáveis de
`calls`, `tokens` e `rowsRead`. O Worker deve impor esses tetos **antes** de cada
chamada ao provedor/consulta SQL, incluindo reformulação, recuperação e sessões
auxiliares das disputas de estoque/benefício/transporte. Um contador HTTP ou
`usage.toolCalls` não é medida de leituras D1.

`adapter.runTurn({scenario,turn,message,checkpoint,idempotencyKey,limits})`
executa `runLunaTurn` e os hooks/checkpoints do roteiro no Worker real. Retorna:

- `metrics`: chamadas reais, tokens reportados pelo provedor e soma de
  `D1Result.meta.rows_read`, não estimativas nem métricas dos testes simulados;
- `messages`, `toolCalls`, `toolResults`, `events`, `proposals`, `presentations`,
  `confirmations`, `commits`, `fallbacks`;
- `stateBefore`, `stateAfter`, `checkpoint`;
- `validation: {passed, violations}`, com os asserts do cenário inteiro,
  ferramentas permitidas/proibidas e invariantes nativas. A aprovação do turno
  não substitui a aprovação dos checkpoints finais.

`adapter.reconcileTurn(idempotencyKey)` consulta um recibo persistido com todos
esses dados. Se uma resposta for perdida, não pode executar novamente a ação
para produzir o recibo. Ausência de resultado mantém a rodada incompleta.

`store.save(expectedVersion,next)` precisa persistir atomicamente e devolver
`false` em conflito. Salvar apenas em memória não é retomada após queda de processo.

## Limites e revisão

O núcleo reserva orçamento durável antes de enviar um turno: 120 chamadas,
250 mil tokens e 100 mil leituras D1 por rodada. Preserva a reserva de chamadas
ambíguas até reconciliação. Métrica ausente ou superior ao teto é bloqueio.
Não refaz cenários concluídos. Sanitiza segredos/e-mails/telefones nos registros
e não mantém raciocínio privado do provedor.

Mesmo com todos os checkpoints aprovados, a saída é
`awaiting_transcript_review`, nunca “certificada” automaticamente. Avaliar cada
transcript quanto a naturalidade, coerência, contexto, pertinência, autonomia,
segurança factual, eficiência, repetição e qualidade do atendimento.

## Limitação atual de integração

O endpoint administrativo existente `/api/ai-lab/luna/playground` não devolve
todo esse contrato, especialmente leituras D1, recibo retomável de turno e
evidências completas. **Não usá-lo como se fosse um adaptador certificado.**
O adaptador nativo instrumentado e seu store durável precisam ser ligados e
validados em homologação antes de executar a rodada real. O núcleo isoladamente
não finaliza esse gate.

Na rodada anterior de 06/10/2026, a consulta pontual a `/release` de staging retornou
`99ffc379dcbd17a84b0a74853becd913ff8a2953`, diferente do código local desta entrega.
Nenhum deploy foi realizado para resolver essa diferença, conforme a proibição
expressa do usuário. Nenhuma chamada ao Groq foi executada.

## Continuação autorizada: somente staging

A instrução posterior autoriza preparar staging, sem produção/merge/WhatsApp.
Staging foi atualizado e `/release` confirmou exatamente
`671da160dc63f0197b24f4c54156ccd185bbf897`. As migrations pendentes até 0044
foram aplicadas. Os arquivos históricos foram preservados; o envio remoto usou
SQL semanticamente equivalente para contornar o parser de triggers CASE/END.

O adaptador agora existe em `scripts/luna/stagingWorker.ts` e
`scripts/luna/stagingHttpAdapter.mjs`. Ainda **não** foi publicado nem utilizado
com Groq. Exige entrypoint separado, staging com automação desativada, bearer
efêmero e `LUNA_CERT_DB` distinta de DB/AUTH_DB. Sem esse conjunto retorna 404.
As evidências são recibos persistidos, sem retry automático de turno ambíguo.

Na continuação seguinte, o ledger persistente passou a medir runtime, setup e
admin, incluindo suas próprias operações. UPDATE RETURNING custa duas leituras
no D1; esse valor é medido e validado, não presumido como zero/uma. Há margem
terminal de 1.000 leituras, sem aumentar o teto de 100.000. Operações SQL ou
provider ambíguos conservam reservas, e a retomada não reinicia os contadores.

Hooks 14/15 agora usam perdas pós-batch e conversas auxiliares reais; não
escolhem ferramentas nem respostas do Groq. O perdedor precisa apresentar
conflito nativo, não somente ausência de operação. Asserts adicionais validam
fingerprints, apresentações, totais, estoque/reservas, cadastro e isolamento.

`certifyStaging.mjs --prepare` cria banco exclusivo identificado e configuração
apenas staging. `finalCertificationGates.mjs` exige árvore de código congelada e
executa offline, test:all e cold upgrades. `certifyStaging.mjs --run` exige esse
relatório no mesmo SHA, publica apenas staging, comprova /release e capabilities
e executa o runner; o bearer temporário só existe em memória/stdin. Resultados
ficam em `.artifacts/luna-certification-staging`, ignorados pelo Git.

Pendências de execução antes de qualquer aprovação real:

- registrar o SHA final da instrumentação e comprovar gates antes do Groq.
- provisionar banco separado e executar o adaptador remoto;
- executar os vinte cenários reais e revisar transcripts; limites são bloqueantes.

O Worker/D1 local aprovou 34 testes (20 roteiros canônicos, variações e 11 testes
do adaptador). Os 90 unitários Luna, typecheck Worker e build também passaram.
Esses resultados não representam execução do modelo real ou revisão de linguagem.
