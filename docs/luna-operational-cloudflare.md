# Luna operacional no Cloudflare

## Estado desta entrega

O runtime novo fica no Worker e está desligado para o WhatsApp de produção por padrão. O playground operacional é habilitado apenas em `staging` e usa o mesmo motor, as mesmas ferramentas e o D1 de staging.

Fluxo:

1. o webhook da Meta persiste a mensagem e um evento tipado no outbox D1;
2. a Queue entrega o evento ao Durable Object da conversa;
3. o modelo Groq decide quais ferramentas tipadas usar;
4. leituras consultam D1 com tenant e módulo obrigatórios;
5. gravações geram uma proposta persistida, sem efeito operacional;
6. uma nova mensagem de confirmação reidrata a proposta do D1 e executa o commit;
7. o commit revalida cadastro, preço, estoque, pacote, horário, versão e status;
8. o resultado é persistido antes da resposta ao cliente.

## Ferramentas permitidas

- contexto do cliente e pets;
- busca de serviços e produtos;
- próximos agendamentos;
- disponibilidade de benefícios de pacote;
- preparação e confirmação de novo agendamento;
- preparação e confirmação de reagendamento;
- preparação e confirmação de cancelamento;
- preparação e confirmação de pedido de produtos;
- transferência para atendimento humano.

Pedido de produto é criado como `pending`: não registra pagamento e não baixa estoque. A agenda reutiliza a transação operacional existente, inclusive alocação automática de pacote. Cancelamento libera reservas pelo trigger operacional existente.

## Segurança e custos

- `GROQ_API_KEY` existe somente como Worker secret;
- no máximo 6 chamadas de modelo e 10 ferramentas por turno;
- teto padrão de 12 mil tokens por turno;
- pausa automática ao restar menos de 20% da cota de requests ou tokens reportada pelo provedor;
- sem fallback silencioso para outro modelo;
- falha ou cota pausada transfere a conversa para humano;
- produção mantém `LUNA_ENABLED=false` e `LUNA_PLAYGROUND_ENABLED=false` até homologação explícita.

## Homologação

Aplicar a migration `0035_luna_operational_foundation.sql` no D1 de staging, publicar o Worker de staging e usar `/api/ai-lab/luna/playground` pelo AI Lab. Testar pelo menos:

- frase fora dos roteiros históricos;
- cliente não encontrado;
- mais de um pet;
- preço e estoque alterados depois do resumo;
- correção após o resumo (`sim, mas...`) sem commit;
- confirmação numa mensagem posterior;
- concorrência/versão alterada antes da confirmação;
- pacote disponível e pacote esgotado;
- agendar, reagendar, cancelar e criar pedido pendente;
- pedido de humano e indisponibilidade do provedor.

Somente depois desses cenários o WhatsApp pode ser ativado em um tenant piloto por configuração controlada. A ativação ampla não faz parte desta entrega.
