# Luna: comparação Workers AI em staging

## Escopo

GLM 4.7 Flash é uma opção experimental de transporte no agente existente, não
outro agente. `ToolLoopAgent`, regras nativas, verificação factual, confirmação,
diário D1 e recuperação durável permanecem os mesmos. Groq continua sendo o
padrão versionado. Produção/WhatsApp não foram habilitados nem migrados.

`workers-ai-provider@4.0.0` é usado com o binding `AI`, disponível apenas na
configuração de staging. A factory recusa GLM fora de staging, com automação
habilitada, modelo desconhecido ou binding ausente. Não há fallback silencioso
para Groq. Provider/modelo integram o fingerprint; checkpoints Groq não são
reutilizados com GLM.

Cada passo faz uma chamada externa, sem retries internos do SDK. Thinking e
chamadas paralelas são desativados. Uso ausente mantém consumo incerto, nunca
zero. Ferramentas devem vir no campo estruturado nativo, com IDs existentes,
schemas válidos e lote íntegro; JSON em texto não autoriza execução.

O transporte remove somente descrições redundantes dentro dos schemas; os
contratos e a validação no servidor continuam íntegros. O teto explícito do
GLM na certificação é 24 mil tokens por turno (antes, o padrão interno de 12 mil
interrompeu quatro chamadas com 15.516 tokens). Os tetos da rodada não mudaram.
O runtime fornece os IDs factuais no schema de encerramento e explicita ações
de rascunho já aplicadas. A auditoria usa consultas limitadas em lote e atualiza
o ledger antes da validação; reservas realmente desconhecidas não são apagadas.
O enum factual orienta a geração, mas a rejeição de uma referência desconhecida
ocorre na fronteira somente-leitura de `finish_turn`, permitindo exatamente uma
reformulação e depois fallback factual. Os schemas de comandos comerciais
continuam obrigatórios antes de qualquer execução.

## Amostra inicial

Quatro cenários fixos: 1 (compra), 6 (pergunta paralela), 11 (compra e agenda) e
13 (alteração após resumo). A rodada é identificada por provider + SHA + sample.
Não equivale a certificar 20/20. Resultados anteriores/ambíguos não são apagados.

Após commit congelado e gates completos:

```sh
node scripts/luna/finalCertificationGates.mjs
node scripts/luna/certifyStaging.mjs --provider=workers-ai --prepare
node scripts/luna/certifyStaging.mjs --provider=workers-ai --publish-browser
```

A publicação é exclusivamente staging. O script não envia conversas: `--run`
é recusado. Entrar no YuiSync `/luna-certification`, carregar a rodada e digitar
cada mensagem do roteiro. Consultas de status não executam novamente o agente.
O fluxo dos cinco blocos exige publicação explícita com `--full` na preparação;
não há promoção automática após a amostra.

## Neurons e limites

Em 08/10/2026, a tabela oficial indica 5.500 neurons/milhão de tokens de entrada
e 36.400/milhão de saída:

`estimativa = (entrada × 5500 + saída × 36400) / 1_000_000`

Exemplo: 250 mil tokens de entrada + 25 mil de saída = 2.285 neurons.
A franquia de 10 mil/dia é compartilhada pela conta, não por roteiro, Worker
ou projeto. Reseta à meia-noite UTC (21h de Brasília). Não garante 20 cenários.

O guard de staging limita conservadoramente a amostra + os cinco blocos do
mesmo SHA a 8 mil neurons estimados, incluindo reservas desconhecidas na tarifa
de saída. Isso **não consulta o saldo diário da conta e não impede sozinho
cobrança externa**. Conferir o consumo disponível no dashboard antes dos testes;
interromper se a margem não comportar o próximo turno. O uso de outros SHAs ou
aplicações também consome a franquia e não deve ser ignorado.

Os tetos por bloco continuam em 120 chamadas, 250 mil tokens e 100 mil leituras
D1. Preparação, status e auditoria são contabilizados pelo ledger existente.
Estimativas em tokens não substituem a medição/fatura Cloudflare.

## Provas

Os testes do transporte simulam o binding, mas passam pelo adaptador oficial.
A compra vertical executa o ToolLoopAgent e Worker/D1 reais com ambos os
transportes simulados: pedido pendente de R$ 90, sem pagamento fictício.
O teste de recuperação usa Durable Object e eviction reais; o teste da amostra
rejeita IDs de rodada alternativos e mistura de providers.

Ainda é necessário executar e revisar a amostra com GLM real pelo navegador,
medindo tokens, neurons, leituras, latência e pertinência dos transcripts.
Nada aqui comprova que GLM é melhor que Groq ou certifica conversas não rodadas.

Fontes oficiais:
- https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/
