# Luna Think no Cloudflare

## Escopo da versão

A Luna Think atende pelo chat autenticado do Next em staging. O runtime é
`LunaThinkAgent`, baseado em `@cloudflare/think`, com Workers AI nativo e modelo
`@cf/zai-org/glm-4.7-flash`. Vendas, agenda e exceções são capacidades da mesma
Luna, carregadas por ferramentas e skills.

O fluxo operacional anterior com Groq permanece no código para compatibilidade
e testes. `LUNA_PROVIDER` e `LUNA_MODEL` configuram esse fluxo anterior; não
selecionam o modelo da Think. O namespace do experimento nativo antigo é
preservado por uma classe inerte, sem executar jobs ou apagar checkpoints.

Esta versão não ativa a Luna no WhatsApp nem em produção. O uso de Think exige
ambiente local/test/staging, `LUNA_RUNTIME=think` e
`LUNA_INTERNAL_CHAT_ENABLED=true`. Em staging, o tenant também precisa constar
em `LUNA_THINK_TENANT_IDS`; a configuração versionada deixa a lista vazia.

## Fluxo do atendimento

1. O servidor autentica o operador e valida tenant, módulo petshop e conversa.
2. O chat envia a mensagem ao Durable Object exclusivo da conversa e recebe
   `202` com o identificador do turno. Reenvios da mesma mensagem são idempotentes.
3. A Luna aguarda 10 segundos após o último fragmento e agrupa as mensagens em
   um único turno. O navegador acompanha o resultado por polling.
4. O Think mantém sessão, memória e execução durável; as ferramentas consultam
   o D1 com escopo obrigatório de tenant/módulo. A memória pessoal não autoriza
   operações nem substitui preços, estoque, frete ou disponibilidade atuais.
5. Uma intenção de escrita prepara uma proposta persistida e apresenta um
   resumo factual, ainda sem efetivar a operação.
6. Somente uma mensagem posterior de confirmação pode executar o commit.
   Correções como “sim, mas troca” exigem novo resumo e nova confirmação.
7. O commit revalida cadastro, preço, estoque, pacote, frete, horário, versão e
   status. Resultados incertos são reconciliados pelo registro da operação;
   o runtime não repete uma gravação às cegas.
8. A resposta e o resultado ficam persistidos. Ao concluir ou desistir, o
   atendimento pode solicitar uma única avaliação opcional de 1 a 5.

## Capacidades e limites

- Consulta de cadastro, pets, histórico, informações da loja e catálogo.
- Carrinho com múltiplos itens, quantidades, retirada ou entrega e frete.
- Cadastro de cliente/pet e preparação de agendamento, reagendamento e cancelamento.
- Consulta de vagas, regras de serviço, benefícios de pacote e transporte.
- Transferência para humano quando solicitada, em identidade ambígua, risco
  clínico ou exceção sem ferramenta disponível.

O pedido de produtos confirmado é criado como `pending`, com reserva de estoque.
Não registra pagamento, não gera Pix e não trata “paguei” como comprovação.
A agenda reutiliza as regras e transações operacionais existentes. Dados
comerciais ausentes no catálogo continuam desconhecidos.

O registro de interesse em reposição exige consentimento explícito. O job
periódico de verificação de reposição está restrito ao ambiente local nesta
versão; não há promessa de aviso automático em staging ou produção.

## Avaliações

Em **Chat → Avaliações**, a equipe consulta as notas. Administradores podem
registrar observação e marcar uma avaliação como revisada, sem alterar o CSAT
informado pelo cliente. A API exige autenticação, escopo de tenant/módulo e
permissão administrativa para a revisão.

## Controle de uso

- Até 6 chamadas de modelo e 10 ferramentas por turno.
- Saída limitada a 800 tokens por chamada de atendimento.
- Compactação da sessão a partir de 4.000 tokens, preservando contexto recente;
  a chamada de resumo também passa pelo orçamento diário.
- Em staging, um Durable Object compartilha reservas e contabilização de uso
  da Luna, com limite configurável até 9.000 neurons por dia UTC.
- O workflow lê o consumo anterior da conta no dia antes de publicar. Outros
  consumidores externos à Luna não passam por esse contador.
- Uso desconhecido mantém a reserva cobrada; esgotamento do orçamento impede
  novas inferências. Não há troca silenciosa de modelo.

Os coeficientes de estimativa de neurons estão em `aiBudget.ts` e devem ser
revistos se o modelo ou a tabela de cobrança mudar. O teto interno não é uma
medição em tempo real de todo o consumo da conta Cloudflare.

## Validação e piloto em staging

O workflow **Luna Think staging** (`.github/workflows/luna-think-staging.yml`):

1. Executa typecheck, regressões Think, testes de avaliações/cota e polling,
   build da interface e dry-run do Worker.
2. Aplica as migrações aditivas somente nos bancos de staging.
3. Prepara tenants descartáveis e publica com somente o tenant de teste liberado.
4. Certifica com autenticação real e Workers AI: mensagens fragmentadas,
   confirmação posterior, pedido pendente, reserva sem pagamento, isolamento,
   nota do cliente e revisão pela interface no navegador.
5. Somente após a certificação, libera o piloto QuatroPatas em staging,
   preservando os demais bindings e exports do Worker.
6. Limpa os dados descartáveis mesmo em caso de falha.

A execução de 19/10/2026 concluiu essas etapas. O resultado de cada nova versão
é registrado no próprio workflow; esse registro histórico não substitui os
checks do commit atual.

A suíte geral também verifica atualização real de bancos históricos v25–v29
até todas as migrações atuais, integridade referencial e reexecução segura das
migrações. O teste do namespace antigo verifica que requests e alarmes não
retomam automação nem apagam o estado preservado.

## Produção

As flags de produção permanecem desativadas. A aprovação em staging e o merge
desta versão não autorizam ativação ampla. A ativação operacional exige uma
entrega explícita com tenant/canal, homologação e acompanhamento definidos.
