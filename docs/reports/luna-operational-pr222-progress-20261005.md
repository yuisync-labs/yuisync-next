# Luna operacional — continuação local da PR #222

Data: 2026-10-05. Base: `ac3bd00`, branch `codex/luna-operational-foundation`.

## Situação: etapa ainda incompleta

Este é um relatório de incremento, não uma aprovação para merge, deploy ou
ativação. Os 20 roteiros não foram integralmente executados. Nenhuma chamada
ao Groq real foi realizada. Não houve merge, deploy, push, ativação de automação
ou envio ao WhatsApp real nesta rodada. Dados reais e Supabase não foram
acessados ou alterados. Alterações locais preexistentes da migração foram
preservadas e não fazem parte deste incremento.

## Implementado desde a base

1. Consultas nativas `get_store_information`, `get_delivery_quote`,
   `get_transport_quote`, `get_available_slots` e `get_operation_status`.
2. Informações da loja sem preencher campos ausentes com padrões inventados.
   Expediente passa pelo normalizador compartilhado com implantação assistida.
3. Entrega consultada por cobertura explicitamente configurada, cidade/bairro e
   taxa inteira em centavos. Contrato opcional em
   `module_settings_extensions.data_json.delivery_coverage`:
   `[{ city, neighborhood, active: true, fee_cents }]`.
   A taxa global isolada não prova cobertura. Configuração ausente, ambígua ou
   inválida falha de forma explícita. Ainda falta a interface de configuração e
   o commit de entrega; este último está bloqueado, não simulado com taxa zero.
4. MotoDog consultado em `transport_options`, com pet vinculado ao telefone,
   peso persistido, cidade da loja e modalidade dentro/fora da cidade.
   A consulta não promete capacidade, reserva ou benefício aplicado.
5. Alternativas de agenda usam duração do catálogo, expediente/fuso
   configurados, capacidade e ocupação reais. Janela máxima de 24h, uma leitura
   limitada a 501 registros e até 12 opções; janela densa retorna erro em vez de
   truncar silenciosamente. Preparação e commit validam expediente e fuso.
   Consultas de conflito têm limite pela capacidade e limite inferior de 24h,
   apoiado no CHECK de duração máxima de 1440 minutos do schema existente.
6. Preparação de banho reutiliza `resolveBillingCatalog` e
   `automaticAllocations`. Snapshot dos benefícios entra no resumo; alteração
   das alocações antes do commit exige outra proposta. Sem alteração histórica.
7. Respostas comuns não enviam diretamente texto livre da LLM. O servidor
   constrói fatos a partir dos resultados estruturados; o modelo seleciona
   referências e próximo passo. Referência inexistente, campos extras ou texto
   operacional livre são rejeitados. Há no máximo uma reformulação, sem
   ferramentas e dentro do orçamento do turno; depois, renderer factual seguro.
8. Resultados de preço/estoque/duração/entrega/transporte/horários/benefícios e
   commits têm renderers específicos. Pedido registrado não significa pagamento.
   A seleção conversacional ainda é conservadora: naturalidade não certificada.
9. Commit faz claim condicional por status/versão. Operação em execução é
   reconciliada por chave idempotente antes de revalidar/preparar outra gravação.
   Agendamento verifica também fingerprint. Resultado incerto não provoca
   repetição automática. Operação já efetivada pode ser recuperada mesmo depois
   do prazo de confirmação, sem executar nova gravação.
10. Timeout, indisponibilidade e quota preservam rascunhos. O caminho WhatsApp
    não converte falha temporária em handoff permanente. Consulta somente-leitura
    tem uma recuperação por turno; commits nunca usam essa repetição.
11. Confirmações nomeadas são vinculadas à família da operação apresentada.
    Negação/correção ou confirmação de outra operação não autoriza commit.
    Todas as provas de apresentação/mensagem posterior continuam obrigatórias.
12. Provedor distingue header ausente de quota zero, omite ferramentas vazias
    na reformulação e rejeita consumo desconhecido/inválido em vez de reportar
    zero tokens. IDs duplicados de chamadas de ferramenta também são rejeitados.
13. Cenário 01 executado com mensagens exatas, relógio fixo, runtime real do
    Worker, D1 local, provedor simulado e checkpoints transacionais.

## Arquivos deste incremento

Novos:

- `apps/edge-api/src/businessHours.ts`
- `apps/edge-api/src/luna/factualResponse.ts`
- `apps/edge-api/src/luna/informationTools.ts`
- `apps/edge-api/test/lunaConfirmationLanguage.test.ts`
- `apps/edge-api/test/lunaDesignedScenario01.test.ts`
- `apps/edge-api/test/lunaFactualResponse.test.ts`
- `apps/edge-api/test/lunaInformationTools.test.ts`
- `apps/edge-api/test/lunaRecovery.test.ts`
- Este relatório.

Alterados:

- `apps/edge-api/src/assistedOnboardingApi.ts` — normalizador compartilhado;
  sem alteração das configurações existentes.
- `apps/edge-api/src/luna/commitProposal.ts`
- `apps/edge-api/src/luna/conversationDurableObject.ts`
- `apps/edge-api/src/luna/proposalPresentation.ts`
- `apps/edge-api/src/luna/providers/groqProvider.ts`
- `apps/edge-api/src/luna/runLunaTurn.ts`
- `apps/edge-api/src/luna/schedulePolicy.ts`
- `apps/edge-api/src/luna/systemPrompt.ts`
- `apps/edge-api/src/luna/toolRegistry.ts`
- `apps/edge-api/test/fixtures/luna/designedScenarios.ts` — permite consultar
  estado da operação na recuperação; nenhuma mensagem/checkpoint foi removido.
- `apps/edge-api/test/lunaOperationalAgent.test.ts`
- `apps/edge-api/test/lunaProvider.test.ts`

Migrations: nenhuma nova nesta rodada. `0037_luna_operation_events.sql` já
existia na base e foi preservada. Migrations anteriores não foram editadas.

## Provas executadas nesta rodada

- `npm run typecheck --workspace @yuisync/edge-api`: aprovado.
- Vitest Worker/D1, 9 arquivos: **64/64 testes aprovados**, execução final
  iniciada às 20:02:06, duração 42,64s.
- Arquivos: `lunaDesignedScenario01`, `lunaRecovery`, `lunaOperationalAgent`,
  `lunaStateAndContracts`, `lunaFactualResponse`, `lunaProvider`,
  `lunaInformationTools`, `lunaConfirmationLanguage`, `assistedOnboarding`.
- `git diff --check` no escopo do incremento: aprovado.
- Cenário 01: três mensagens exatas, 9 chamadas ao provedor **simulado**, seis
  ferramentas previstas, nenhuma ferramenta proibida, estado persistido entre
  turnos, resumo registrado antes da confirmação, uma venda pendente de R$90,
  nenhum pagamento. Isso não prova compreensão pela LLM real.

Não foram executados como regressão final deste incremento: suíte completa
Worker, `test:luna`, `test:petbot`, contratos, typechecks de raiz/contratos,
build ou `test:all`. Resultados anteriores não são reapresentados como prova
do código atual. A regressão final depende do fechamento dos cenários.

## Resultado individual dos 20 roteiros

“Não executado” é pendência bloqueadora, não aprovação implícita por teste
unitário semelhante. O caso 01 passou seus checkpoints locais, mas a
certificação completa continua bloqueada.

| Nº | Cenário | Offline Worker/D1 | Groq staging |
|---:|---|---|---|
| 1 | Compra retirada pendente | Checkpoints aprovados | Não executado |
| 2 | Carrinho multitem | Não executado | Não executado |
| 3 | Troca de marca | Não executado | Não executado |
| 4 | Remoção e quantidade contextual | Não executado | Não executado |
| 5 | Indisponibilidade e alternativa | Não executado | Não executado |
| 6 | Pergunta paralela loja/entrega | Não executado | Não executado |
| 7 | Pausa e histórico longo | Não executado | Não executado |
| 8 | Referências e ambiguidade | Não executado | Não executado |
| 9 | Endereço corrigido e retirada | Não executado | Não executado |
| 10 | Cadastro novo confirmado | Não executado | Não executado |
| 11 | Banho e compra independentes | Não executado | Não executado |
| 12 | Sim informativo | Não executado | Não executado |
| 13 | Correção após resumo | Não executado | Não executado |
| 14 | Commit/reenvio ambíguos | Não executado | Não executado |
| 15 | Concorrência financeira | Não executado | Não executado |
| 16 | Datas, reagendamento e cancelamento | Não executado | Não executado |
| 17 | Pet, serviço e número da máquina | Não executado | Não executado |
| 18 | MotoDog e modalidade | Não executado | Não executado |
| 19 | Falha e humano/risco clínico | Não executado | Não executado |
| 20 | Injeção e isolamento | Não executado | Não executado |

## Falhas identificadas e correções

- Resposta comum da LLM podia sair sem verificação: contrato de referências
  verificadas e teste de duas respostas inventadas seguidas, com fallback seguro.
- Quota/erro temporário causava handoff permanente: retirado; estado preservado
  em testes de timeout, indisponibilidade e quota.
- Resposta perdida de commit podia revalidar a própria vaga já ocupada:
  reconciliação anterior à validação; teste de venda gravada sem completion marker.
- Commit incerto sem operação encontrada podia ser repetido: bloqueio seguro.
- Proposta de entrega omitia contrato completo e taxa: preparação bloqueada
  explicitamente enquanto o fluxo ainda não está implementado.
- Agenda ignorava expediente: validação compartilhada, incluindo domingo fechado
  e opções ocupadas no D1 local.
- Benefício podia diferir do resumo: snapshot na proposta e comparação no commit.
- Header ausente se tornava zero: preserva indisponibilidade como `null`.
- Consumo ausente podia virar zero: erro explícito e testes de uso inválido.
- Falhas iniciais dos novos testes: fixture de recuperação precisava criar a
  conversa antes do evento; expectativas antigas de texto livre precisavam usar
  o novo contrato factual. Ambas corrigidas sem remover invariantes financeiras.

## Consumo e isolamento

- Chamadas ao Groq real: **0**.
- Tokens consumidos no Groq real nesta rodada: **0**.
- Operações D1 em staging/produção nesta rodada: **nenhuma**.
- Envios a números reais: **0**.
- Leituras locais não foram agregadas por rodada. Instrumentação de `rows_read`
  e orçamento global, checkpoints retomáveis e abortos de consumo desconhecido
  ainda precisam ser integrados ao runner de certificação real.
- Não existe transcript real desta rodada para revisar. A revisão humana dos
  20 transcripts continua pendente, inclusive naturalidade.

## Bloqueadores restantes, em ordem de continuidade

1. Cadastro confirmado de cliente/pet novo por comandos nativos compartilhados,
   identidade baseada no telefone e idempotência, sem merge ambíguo.
2. Endereço/referência e quote persistidos na proposta/commit de entrega,
   revalidação de cobertura/taxa e implantação da configuração explícita.
3. MotoDog integrado ao commit nativo, alocação/reserva/benefício, mudança de
   modalidade e retirada de taxa/reserva ao voltar ao transporte pelo cliente.
4. Reserva de estoque e seu ciclo nativo para pedido pendente; corrida pela
   última unidade e capacidade concorrente da agenda precisam de prova/fix.
5. Número da máquina persistido apenas quando o serviço realmente o exige.
6. Planejamento estruturado completo, contexto de opções apresentadas/pergunta
   pendente, resumo conversacional seguro e ciclo de conclusão dos rascunhos.
7. Completar os renderers factuais restantes e melhorar flexibilidade/naturalidade
   sem reabrir envio de afirmações operacionais livres. O catálogo conservador de
   aberturas/perguntas atual ainda não satisfaz a certificação de naturalidade.
8. Adaptador de execução/checkpoints dos outros 19 roteiros offline, incluindo
   falhas injetadas, variações controladas e invariantes de concorrência.
9. Após todos os offline aprovados, mesmos 20 com Groq real em staging isolado,
   limite de 120 chamadas/250 mil tokens/100 mil leituras por rodada, medição real,
   checkpoints e revisão dos transcripts. Caso não executado permanece pendente.
10. Regressão final completa e `test:all` na integração final.

## Distinção de entrega

- **Código implementado:** incremento local acima, não o plano inteiro.
- **Código certificado:** provas locais delimitadas (64 testes e checkpoints do
  cenário 01); certificação completa offline/Groq/regressões **não concluída**.
- **Código publicado:** nada deste incremento foi publicado; nenhum deploy/merge.
- **Automação habilitada:** nenhuma ativação; WhatsApp real não foi usado.

Esta etapa NÃO está concluída e não está autorizada para liberação por este relatório.
