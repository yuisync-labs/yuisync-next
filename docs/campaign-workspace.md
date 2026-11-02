# Campanhas: estrutura inicial

A rota existente `petshop/campanhas` passa a oferecer uma lista de rascunhos e um
editor com público, mensagem/template, orçamento/envio e acompanhamento.

## Escopo entregue

- Seis segmentos: ausência, todos, recorrentes, recorrentes sem retorno, primeira
  visita sem retorno e nunca atendidos. Os valores são preferências para a futura
  consulta; esta versão não calcula destinatários.
- Regras editáveis de ausência, recorrência, exclusão de agendamento futuro e
  intervalo entre campanhas. Atendimento concluído será a referência de visita.
- Ideia original, texto manual, personalizações de tutor/pet/loja, prévia fictícia,
  ação principal e confirmação da versão do texto. Editar o texto revoga a revisão.
- Orçamento planejado e data/hora desejadas; nenhuma tarifa não validada é fixada.
- Rascunhos locais (até 50) em chave versionada por usuário, tenant e módulo.
  Salvamento automático, manual e na saída. Não há sincronização entre dispositivos.
  Não são persistidos destinatários, tokens ou dados da carteira.
- Estados indisponíveis explícitos para IA, submissão à Meta e disparo. Nenhuma
  requisição de envio, template ou audiência é feita pela página.

## Próximas integrações

1. Persistência autenticada no backend e migração explícita dos rascunhos locais.
2. Consulta paginada da carteira por tenant, usando somente visitas concluídas;
   separar sem histórico, deduplicar telefones e validar consentimento/descadastro.
3. Formatação via LLM sem alteração de oferta, confirmação e versões imutáveis.
4. Templates com componentes, exemplos de variáveis, botões e opção de descadastro;
   reutilizar a API existente, adicionando persistência de status/webhooks e paginação.
5. Tarifas versionadas e moeda da WABA, estimativa, limite de gasto e revisão final.
6. Agendamento no fuso da loja, fila dedicada, envio de templates aprovados,
   tratamento de respostas incertas e atualização das métricas por webhooks.

A confirmação editorial não equivale à aprovação da Meta nem à autorização para
disparar. O próximo estágio requer validação real da conta Cloudflare do projeto e
do app/WABA. Não há deploy, cobrança ou teste prático com a Meta nesta alteração.
