# Luna: aplicação do AI SDK ao agente operacional

## Escopo e divisão de responsabilidades

Revisão da arquitetura relevante do AI SDK 7: agentes, workflows, tools e schemas, contexto, memória, saída estruturada, erros, lifecycle/telemetria, testes, persistência da interface e Groq. Não é necessário incorporar APIs de imagens, áudio, embeddings, RSC, MCP ou memória terceirizada para atender esta entrega.

O SDK coordena o turno; o domínio autoriza e executa efeitos. Não se copia um chatbot genérico que pode gravar diretamente o que o modelo solicitar.

| Camada | Implementação | Responsabilidade |
| --- | --- | --- |
| Coordenação | `apps/edge-api/src/luna/sdkAgent.ts` | Um `ToolLoopAgent`, `prepareStep`, tools com `execute`, execução sequencial, stop conditions e saída de ferramentas compactada. |
| Transporte | `providers/groqSdkProvider.ts` | `createGroq`/interface single-call `doGenerate`. Sem outro `generateText`, retry oculto ou execução comercial. |
| Fronteira de consumo | `runLunaTurn.ts` e ledger de certificação | Contabiliza cada chamada efetiva, uso conhecido em erro, limites de turno/rodada e pausa por quota. |
| Estado | Repository/reducer D1 existente | Operações independentes, versão/CAS, eventos idempotentes, opções apresentadas e pergunta pendente. |
| Ferramentas | `draftTools.ts` + registry nativo existente | Comandos pequenos de rascunho; consultas e prepare/commit continuam nas regras reais do Worker. |
| Comunicação | `finishTurn.ts`, `factualResponse.ts`, `proposalPresentation.ts` | Fatos referenciados por ID, renderer factual, uma reformulação limitada e evidência de apresentação. |
| Canal | Durable Object/fila/playground existentes | Mesmo agente e provedor SDK; automação não é habilitada por esta refatoração. |

## Decisões importantes

- `ToolLoopAgent` substitui o `for (;;)` de inferência/execução. O adaptador LanguageModel mantém a interface de contabilização já usada pela certificação e os provedores simulados. Não é um segundo agente.
- O provider Groq faz uma única chamada via interface de modelo do SDK. A camada de transporte não instancia um ciclo de geração adicional.
- `prepareStep` carrega estado D1 atualizado, fatos consultados e capacidades permitidas. `activeTools` reduz ações indisponíveis; nunca é autorização suficiente por si só.
- `toolsContext` contém identidade/escopo fornecidos pelo servidor, validado antes da execução; `runtimeContext` contém apenas o trace ID. Não são argumentos que a LLM pode inventar.
- Os comandos `draft_add_item`, `draft_remove_item`, `draft_replace_item`, `draft_set_quantity`, `draft_set_field`, `draft_set_fulfillment`, `draft_pause`, `draft_resume` e `draft_cancel` têm schemas planos. Modalidade usa um comando próprio com enum `counter`/`delivery`, não texto arbitrário. O reducer aplica a mesma restrição ao comando legado e a estados persistidos. Versão esperada e ID do evento são resolvidos no backend. Replay recupera a versão original e verifica fingerprint.
- `record_turn_decision`/`update_operation_draft` não são ferramentas expostas aos providers SDK reais. Permanecem como comandos internos e adaptadores de testes antigos. Não há mais envelope aninhado `decisionWithResponse`.
- SDK pode executar ferramentas paralelamente: o executor é serializado. Qualquer erro fatal impede comandos já enfileirados. Todo lote é verificado antes de executar seu primeiro comando; finalizar junto com commit é recusado.
- `isStepCount(6)` substitui o default de vinte passos. O orçamento independente continua limitando seis chamadas totais (incluindo reformulação) e dez ferramentas. `maxRetries: 0`; nenhum reparo automático de argumentos financeiros.
- A saída livre do modelo não vai ao cliente. O domínio valida e renderiza fatos, propostas e resultados; uma reformulação ocorre dentro do mesmo orçamento. Streaming de afirmações não verificadas fica desabilitado.
- Aprovação genérica do SDK não substitui a confirmação comercial: a política existente exige resumo vigente efetivamente apresentado e mensagem posterior vinculada a ele.
- Para uma intenção de compra ativa, finish_turn não pode omitir o próximo dado material nem substituir a preparação por uma saudação. Um carrinho completo exige proposta nativa da versão atual; perguntas informativas paralelas continuam independentes. Fatos de pets não são renderizados em respostas exclusivamente de compra. O checkpoint de retirada do cenário 1 exige proposta, total e apresentação correspondentes, não somente ausência de venda prematura.
- Não se adiciona memória vetorial ou serviço externo. D1 continua sendo fonte de verdade; histórico é contexto, não autoridade sobre preço/estoque/agenda.
- A interface de certificação já persiste mensagens e apresenta respostas finais. Adoção de `useChat`/streaming não é requisito para usar AI SDK Core corretamente e não mudará o protocolo WhatsApp nesta entrega.
- Telemetria SDK externa está desabilitada, com `recordInputs`/`recordOutputs: false`. Permanecem traces sanitizados do Worker e contabilização por chamada. Raciocínio privado não é registrado.

## Verificação e limitações

Testes HTTP simulados exercitam o provider SDK real, Worker e D1. Testes do coordenador cobrem serialização, contexto servidor-only, lotes inválidos, parada, quota e ausência de retry. Os vinte roteiros existentes continuam usando o runtime real com respostas simuladas; isso não prova compreensão de linguagem do Groq.

Fixtures antigas sem mensagem inbound usam um scaffold explicitamente restrito a `executionMode: fixture`. Fora disso, não se inventa mensagem nem confirmação: histórico ausente bloqueia execução.

A camada factual ainda tem conectivos/perguntas controlados. A naturalidade e a interpretação dos vinte cenários precisam de nova certificação real no navegador, com revisão humana. Não declarar a PR integralmente certificada só porque testes locais passam. Preservar a contabilização desconhecida da rodada anterior; não zerar reservas para liberar novas tentativas.

Sem nova migration, mudança no Supabase ou dados reais. Sem merge, deploy ou ativação automática.

## Fontes oficiais consultadas

- [Agents overview](https://ai-sdk.dev/docs/agents/overview) e [Building agents](https://ai-sdk.dev/docs/agents/building-agents).
- [Loop control](https://ai-sdk.dev/docs/agents/loop-control) e [Workflow patterns](https://ai-sdk.dev/docs/agents/workflows).
- [Tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
- [Runtime and tool context](https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context).
- [Memory](https://ai-sdk.dev/docs/agents/memory).
- [Error handling](https://ai-sdk.dev/docs/ai-sdk-core/error-handling).
- [Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry).
- [Testing](https://ai-sdk.dev/docs/ai-sdk-core/testing).
- [Chatbot message persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence).
- [Groq provider](https://ai-sdk.dev/providers/ai-sdk-providers/groq).
