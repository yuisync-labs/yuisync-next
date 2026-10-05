# Luna operacional — entrega incremental 1

Data: 2026-10-05. Base local: `99ffc379dcbd17a84b0a74853becd913ff8a2953`.

## Situação

Implementação parcial do plano aprovado. **Não é certificação dos 20 roteiros, não
é publicação e não habilita WhatsApp.** Nenhuma credencial, dado de cliente real,
Supabase, workflow do legado ou configuração remota foi alterado.

## Baseline e causa raiz

O erro `No such module cloudflare:test-internal` foi reproduzido no sandbox.
Os mesmos dois arquivos passaram fora da restrição de rede local: 18 testes.
Não houve troca de dependências nem patch em `node_modules`. O servidor interno
do pool de testes precisa de comunicação local permitida. O erro de logs no
perfil do Windows foi removido direcionando-os para `.wrangler/test-logs/`.

## Inventário classificado

| Grupo | Exemplos | Tratamento |
|---|---|---|
| Regra operacional | catálogo, quantidades, agenda, versão de agendamento, pacote, pedido pendente | preservar; usar executores de domínio existentes |
| Segurança | tenant, cliente verificado, schemas, confirmação, idempotência, quotas | reforçar no servidor; nunca delegar autoridade ao modelo |
| Workaround conversacional | frases obrigatórias, perguntas em sequência fixa, fallback por formato | não expandir; substituir na etapa de planejamento/verificação factual |
| Dívida de legado | simulador com intenções pré-definidas, runtime server, memória curta | manter como regressão, não como prova de compreensão da LLM |

## Caminho da mensagem

WhatsApp: webhook → outbox → fila → Durable Object serializado → `runLunaTurn`
→ registry → D1/executores → resposta → envio aceito → apresentação persistida.

Playground: API administrativa → mensagem persistida → mesmo `runLunaTurn`
→ resposta persistida → apresentação persistida. Nenhum envio WhatsApp.

## Alterações implementadas

- Estado schema v1 com carrinho, agenda e cadastro independentes, foco, pausa e
  retomada. Adaptador de `{}`; formatos desconhecidos bloqueiam, sem apagar dados.
- Reducer Worker-safe derivado das invariantes do legado: transições imutáveis,
  terminais, versão esperada, IDs de catálogo e quantidades. Não importa Node/server.
- Ferramenta `update_operation_draft`; campos financeiros não pertencem ao draft.
- Eventos deduplicados por mensagem/índice, fingerprint canônico e CAS; replay
  conflitante falha. Campos idênticos não invalidam proposta nem avançam draft.
- Migration **aditiva** 0037 para eventos, operação da proposta e apresentações.
- Propostas vinculadas ao draft/version; uma compra não invalida um banho.
  Propostas legadas sem vínculo são invalidadas conservadoramente por família.
- Schemas validados recursivamente no servidor; campos extras, coerção de tipos,
  quantidades fora do limite e schemas não suportados são rejeitados.
- Consultas/preparação/commit verificam cliente ativo único pelo telefone da conversa.
- Produtos duplicados rejeitados antes de checar estoque, evitando soma não validada.
- Resumo comercial factual é anexado pelo servidor, não escrito apenas pelo modelo.
- Confirmação exige apresentação persistida, fingerprint/version iguais e mensagem
  posterior. Mensagem intermediária suspende o alvo; múltiplos resumos não podem
  ser confirmados por um "sim" ambíguo. `present_proposal` permite reapresentação.
- WhatsApp registra apresentação somente após envio aceito; playground somente
  depois de salvar a resposta. Propostas antigas sem evidência não executam.
- Telemetria de ferramentas redige texto livre/identificadores; conserva estrutura,
  números, booleanos e códigos de erro. Dados operacionais ficam no armazenamento
  de domínio, não são duplicados em traces.
- Histórico distingue fala humana da fala anterior do agente.
- Os 20 roteiros desenhados foram versionados em
  `apps/edge-api/test/fixtures/luna/designedScenarios.ts`: mensagens exatas,
  relógio/fuso, fixture fictícia, checkpoints, ferramentas e falhas injetáveis.
  São especificações; sua presença **não** representa execução/certificação.

## Evidências executadas

- Baseline: 18/18 testes nativos.
- Luna nativa após alterações: 28/28 testes em três arquivos, incluindo confirmação
  sem apresentação/pergunta paralela, operações independentes, contratos, identidade,
  replay conflitante, estado desconhecido e redação de telemetria.
- Upgrade D1: 3/3 testes (matriz v25–v29 e dois cold upgrades independentes). A fixture
  agora remove objetos aditivos ao simular snapshot antigo antes de reexecutar 0037.
- `test:luna`: 79 unitários, 9 regressões e 157 evals offline existentes passaram.
  **Esses evals não são prova de compreensão linguística da Groq.**
- `test:petbot`: 198/198 passaram.
- Typecheck Worker, typecheck contratos, build frontend e diff whitespace passaram.
- Contratos: 53/53 testes em oito arquivos passaram. A primeira tentativa bloqueada
  pelo sandbox em rename de arquivos temporários não contou como execução.
- A rodada ampla Worker iniciou antes da correção das fixtures de upgrade:
  **326 passaram, três falharam, 81 arquivos, 329 testes, 328,81 segundos**.
  Não contar essa rodada como verde; os três upgrades corrigidos foram rerodados
  acima e passaram. Não foi executado `test:all` nem uma segunda rodada ampla.

## Ainda necessário — não apresentado como concluído

1. Decisão estruturada multi-intenção, referências/opções/pergunta pendente e memória
   resumida com recuperação segura. Hoje o modelo ainda planeja por tool calls.
2. Ferramentas completas para cadastro confirmado, loja/expediente, disponibilidade,
   entrega/taxas/endereço, MotoDog e integração consistente com políticas nativas.
3. Reserva concorrente de estoque usando o domínio nativo. Pedido ainda é pendente;
   não foi criada baixa ou pagamento fictício.
4. Verificação das **respostas comuns**, referências a fatos, uma reformulação dentro
   do orçamento e fallback factual. O bloco comercial foi protegido nesta entrega,
   mas texto livre do modelo ainda não recebeu a verificação completa planejada.
5. Atualizar status do draft após commit, reconciliação de resultado ambíguo,
   retry limitado e retomada após quota sem perder contexto.
6. Implementar o adaptador e executar os 20 roteiros já versionados no Worker/D1 local e depois
   com LLM real em staging isolado, com revisão humana dos transcripts.
7. Orçamento real retomável: 120 chamadas/250 mil tokens/100 mil leituras D1,
   parando no primeiro limite. Nesta entrega: **zero chamadas reais ao modelo**,
   zero leitura/escrita em D1 remoto e zero mensagens WhatsApp reais.
8. Integração final `test:all`, PRs sequenciais e publicação do mesmo SHA aprovado.
   Produção permanece sem alteração e automação não foi habilitada.

## Aplicação futura

0037 deve ser aplicada antes de habilitar o código novo em qualquer ambiente.
Não reaplicar/regravar migrations antigas. Manter flags Luna desligadas durante
publicação e certificar o ambiente isolado antes do piloto autorizado.

As alterações preexistentes do importador Quatro Patas continuam separadas e
preservadas; não devem entrar por acidente numa PR Luna.
