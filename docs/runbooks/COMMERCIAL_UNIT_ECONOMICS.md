# Custos e preço comercial do YuiSync

Data-base: 16 de setembro de 2026.

Este documento separa custos confirmados, premissas conservadoras e decisões que ainda dependem de medição. Ele não autoriza sozinho a alteração de preços na Stripe. Como preços recorrentes da Stripe são imutáveis, qualquer mudança comercial deve criar novos `Price IDs`, atualizar os secrets dos dois ambientes e validar o checkout em modo teste antes da promoção.

## Custos confirmados

| Componente | Regra usada no cálculo | Fonte |
| --- | --- | --- |
| Stripe | 3,99% + R$ 0,39 por cartão nacional aprovado. Não há mensalidade no preço padrão. | [Stripe Brasil](https://stripe.com/br/pricing) |
| Cloudflare Workers | US$ 5/mês; inclui 10 milhões de requisições e 30 milhões de ms de CPU por mês. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Cloudflare D1 | No plano pago, 25 bilhões de linhas lidas e 50 milhões escritas por mês estão incluídas; excedentes custam US$ 0,001 por milhão de leituras e US$ 1 por milhão de escritas. | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Resend | Gratuito até 3.000 e-mails/mês (máximo de 100/dia); Pro custa US$ 20/mês e inclui 50.000. | [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing) |
| OpenAI GPT-4o mini | US$ 0,15 por milhão de tokens de entrada e US$ 0,60 por milhão de tokens de saída. | [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| WhatsApp Business Platform | A Meta cobra por mensagem entregue e por categoria/mercado. O rate card vigente precisa ser conferido no portfólio Meta da empresa antes de publicar uma franquia. | [Meta/WhatsApp pricing](https://whatsappbusiness.com/pt-br/products/platform-pricing/) |

Para orçamento interno em real, usamos câmbio de segurança de **R$ 6,00/US$**, e não a cotação do dia. Essa margem absorve variação cambial e tributos sem prometer um custo artificialmente baixo.

## Receita líquida atual após Stripe

| Plano | Mensal | Tarifa Stripe estimada | Entrada líquida | Anual líquido | Equivalente mensal do anual |
| --- | ---: | ---: | ---: | ---: | ---: |
| Start | R$ 197 | R$ 8,25 | R$ 188,75 | R$ 1.891,01 | R$ 157,58 |
| Pro | R$ 347 | R$ 14,24 | R$ 332,76 | R$ 3.331,16 | R$ 277,60 |
| Prime | R$ 597 | R$ 24,21 | R$ 572,79 | R$ 5.731,41 | R$ 477,62 |

O anual atual equivale a dez mensalidades. A margem do anual deve ser medida pelo equivalente mensal, não pelo preço mensal de vitrine.

## Premissas internas que precisam de telemetria

Os valores `support_cost_brl` e `infra_cost_brl` existentes no catálogo D1 são estimativas, não medições contábeis:

| Plano | Suporte estimado | Infra estimada | Limite de IA antigo |
| --- | ---: | ---: | ---: |
| Start | R$ 39 | R$ 24 | 0 |
| Pro | R$ 69 | R$ 31 | 0 |
| Prime | R$ 119 | R$ 41 | 12.000 requisições |

O limite de 12.000 requisições do Prime não deve ser anunciado. Hoje ele gera alerta, mas não é um teto transacional forte, e não mede tokens. Antes de vender IA por franquia, o runtime deve registrar tokens de entrada, saída, modelo e custo por execução.

A sessão individual incluída tem duração máxima de 60 minutos. Para cálculo, reserve R$ 120 por nova empresa e amortize em 12 meses (R$ 10/mês). Reagendamentos adicionais e implantação de dados fora do fluxo padrão são serviços separados.

## Política recomendada

1. Manter os preços públicos atuais durante o piloto e não recriar os preços Stripe nesta entrega.
2. Não anunciar Campanhas nem Luna como recurso comercial concluído até a certificação funcional desses módulos.
3. Manter Start com 1 acesso, Pro com até 3 e Prime com até 5.
4. Substituir a promessa de 12.000 mensagens de IA por **2.000 execuções assistidas**, somente depois de existir medição real por tokens e bloqueio de cota. Excedente deve ser pré-pago, nunca uma conta aberta.
5. Tratar marketing pelo WhatsApp como consumo extra. Mensagens operacionais podem ter franquia apenas depois de confirmar quem é o pagador da WABA e implementar um ledger pré-pago.
6. Se a Meta cobrar diretamente a empresa dona da WABA, o YuiSync não deve revender esse consumo: deve mostrar estimativa e link de cobrança da Meta.
7. Se o YuiSync for o pagador, a proposta inicial é 1.000 mensagens operacionais no Pro e 3.000 no Prime; marketing fica sempre fora da franquia. O saldo deve ser reservado antes do envio.

## Próxima tabela, após o piloto

Com telemetria de 30 dias e os recursos de IA certificados, a faixa recomendada é:

| Plano | Mensal recomendado | Anual recomendado | Motivo |
| --- | ---: | ---: | --- |
| Start | R$ 197 | R$ 1.970 | A operação básica já mantém margem para suporte assistido. |
| Pro | R$ 397 | R$ 3.970 | Absorve atendimento integrado, suporte e eventual franquia operacional de WhatsApp. |
| Prime | R$ 697 | R$ 6.970 | Cria reserva para IA, maior suporte e variabilidade da Meta. |

Esses valores são proposta, não configuração ativa. Para aprová-los, medir por empresa: requisições Worker, `rows_read`, `rows_written`, e-mails, tokens de IA, mensagens Meta por categoria, minutos de suporte e taxa de falhas/reprocessamentos.

## Critérios antes de mudar os preços

- 30 dias de telemetria do piloto, sem contagem por varredura completa no D1;
- cota de IA aplicada antes da chamada ao provedor;
- ledger de WhatsApp ou confirmação de cobrança direta ao cliente;
- Luna e Campanhas removidas da oferta ou certificadas;
- novos produtos/preços criados no modo teste da Stripe;
- compra, webhook, ativação, cancelamento e retomada validados;
- promoção dos novos `Price IDs` por secrets, sem gravar credenciais no repositório.
