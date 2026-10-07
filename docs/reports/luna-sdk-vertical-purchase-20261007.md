# Luna: integração vertical do AI SDK — 07/10/2026

## Escopo

Primeira aplicação da revisão arquitetural: preservar comandos comerciais,
confirmação, identidade e D1; padronizar o protocolo com `ai@7.0.130` e
`@ai-sdk/groq@4.0.57`. Nenhum novo modelo, provedor remoto ou banco.

O SDK é um adaptador de inferência de um passo. Não tem callbacks `execute`
para ferramentas, não repete requests e não mantém um segundo agente. O Worker
continua executando o registry, autorização, idempotência e orçamento. O
adaptador foi ligado somente ao entrypoint de certificação isolado; as fábricas
de produção não foram alteradas. Não houve merge, deploy ou ativação WhatsApp.

## Implementação

- `providers/groqSdkProvider.ts`: mensagens tipadas, parsing pelo SDK, strict
  schemas, tradução dos parâmetros, uma chamada HTTP por inferência, retries
  desativados, timeout e contabilização do uso conhecido em respostas inválidas.
- GPT-OSS continua com `include_reasoning:false`; o adaptador não devolve
  raciocínio privado nem mensagens brutas de erro do provedor.
- `agentContext.ts`: estado D1 atual aparece uma única vez; omite resumo
  derivado repetido e payloads de rascunho redundantes, sem cortar mensagens,
  endereços, IDs, opções aceitas ou alvos de confirmação.
- `finishTurn.ts` / `runLunaTurn.ts`: `record_turn_decision` pode trazer uma
  continuação somente leitura. Ela é removida dos argumentos antes da execução
  nativa e validada depois contra o estado persistido e fatos consultados.
  Resposta inválida permite uma correção restrita, sem repetir a alteração.
- Preparação e commit bem-sucedidos podem encerrar com resumo/resultado nativo,
  sem uma inferência adicional para reinterpretar o resultado comercial.
- `systemPrompt.ts`: um único writer exposto de intenção + eventos, juntos.
- `scripts/luna/stagingWorker.ts`: usa o adaptador no playground isolado,
  preservando ledger e limites existentes.
- `apps/edge-api/package.json` e lockfile: versões fixadas; nove pacotes
  instalados, sem scripts de instalação; nenhuma remoção massiva do lockfile.
- Sem migrations ou alterações em dados reais/Supabase.

## Provas executadas antes da regressão final

- Typecheck do Worker aprovado.
- 54 testes em seis arquivos aprovados no runtime workerd/D1 local.
- Cenário 1 vertical executado com SDK real, HTTP de modelo simulado e D1 local:
  compra → carrinho → retirada → resumo apresentado → confirmação posterior →
  uma venda pendente de R$ 90; zero pagamentos. Cinco chamadas, contra oito
  no teste anterior do mesmo percurso. Isso NÃO mede tokens reais nem prova
  compreensão do Groq.
- Continuação falsa “Está pago.” rejeitada; uma reparação somente leitura;
  carrinho persistido uma vez; nenhuma venda criada antes da confirmação.
- HTTP 400/401/429/503: erro sanitizado, uma tentativa e sem replay oculto.
- Ferramenta desconhecida rejeitada com consumo conhecido preservado;
  consumo ausente não foi convertido em zero.

## Falhas corrigidas durante a integração

1. Runner restrito não iniciou (`cloudflare:test-internal`/permissão de logs).
   Reexecução autorizada com workerd local e logs no workspace executou os
   testes. A tentativa sem runner não foi contada como aprovação.
2. O AI SDK 7 exige instruções fora de `messages`. A primeira integração D1
   falhou antes da chamada HTTP. Instruções foram movidas para `instructions`;
   os dois testes verticais passaram depois da correção.

## Gates e limites

O relatório de gates do SHA anterior não certifica esta alteração. A regressão
final deve executar os 20 roteiros offline, `test:all`, audit e cold upgrades
no SHA deste commit, com resultado em
`.artifacts/luna-certification-staging/gates.json`.

Nenhuma chamada Groq real nesta etapa de implementação. O navegador lateral
ainda serve a versão anterior até publicação explícita em staging. A rodada
real segue pendente e deve usar o navegador, o tenant isolado e os tetos
120 chamadas / 250 mil tokens / 100 mil leituras D1.

## Dívida explícita

- A restrição lexical das respostas sociais e perguntas predefinidas ainda
  existe. Esta integração NÃO certifica naturalidade e não resolve sozinha a
  verificação semântica de linguagem livre.
- Os 20 roteiros offline existentes continuam necessários, mas usam decisões
  simuladas; o teste vertical adicional cobre o protocolo SDK. Os outros 19
  roteiros ainda não ganharam uma execução equivalente do novo adaptador.
- Ainda não há medição real de economia de tokens/latência do novo percurso.
- Node local 24.18.0; os manifests exigem 22.x. Não afirmar teste em Node 22.
- Não promover a integração a produção antes de certificar conversa real,
  retomadas, perguntas paralelas e os 20 cenários obrigatórios.

Estado: código implementado para o piloto vertical; certificação local focada
aprovada; certificação final/LLM pendente; código não publicado; automação real
desabilitada.
