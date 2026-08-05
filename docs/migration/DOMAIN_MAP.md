# Mapa de Domínios

## Objetivo

Este documento define limites de responsabilidade antes de mover arquivos. A estrutura atual é referência de localização, não o desenho definitivo.

## Domínios propostos

| Domínio | Responsabilidades | Locais atuais relevantes | Limite desejado |
|---|---|---|---|
| `identity-tenancy` | autenticação, autorização, usuários, papéis, módulos e isolamento | `server/lib/auth.js`, `api/admin/users*`, `src/context`, SQL/RLS | expor identidade e permissões por contratos; nenhum outro domínio consulta auth diretamente |
| `customers-pets` | clientes, tutores, pets, dados cadastrais e vínculos | `src/modules`, hooks/componentes, tabelas e migrations | separar cadastro genérico de atributos específicos de petshop |
| `catalog` | produtos, serviços, preços, imagens, disponibilidade comercial | `server/lib/petbotCatalog.js`, `api/products`, frontend e SQL | catálogo não cria pedidos nem agenda horários |
| `scheduling` | agenda, capacidade, slots, bloqueios, reagendamento e cancelamento | SQL operacional, PetBot, Luna e testes transacionais | única autoridade para disponibilidade e reserva |
| `orders` | carrinho, pedido de produto, checkout, totais e status | `server/lib/checkout.js`, `api/petshop/checkout.ts`, order bot | não aceitar campos de agendamento de serviço |
| `service-bookings` | contratação de serviço, pet, profissional, horário e confirmação | PetBot, chat, SQL de agenda e operações | não aceitar entrega, retirada, troco ou pagamento antecipado por padrão |
| `payments` | intenção, método, cobrança, conciliação, estorno e idempotência | checkout, vendas, integrações futuras | efeitos financeiros isolados e idempotentes |
| `messaging` | WhatsApp, dashboard chat, ingestão, envio, debounce e handoff | `api/webhook.ts`, `server/lib/dashboardChat.js`, `server/lib/chat.js` | canais transportam mensagens; não decidem regras de negócio |
| `agents` | interpretação de linguagem, planejamento de ferramentas e respostas | `server/lib/petbotAgent.js`, `server/lib/petbotAi.js`, `server/lib/luna/` | agentes não persistem efeitos diretamente; chamam casos de uso tipados |
| `fiscal` | emissão, consulta e webhooks fiscais | `server/lib/fiscal.js`, `api/fiscal/`, Focus NFe | isolado de pedidos por eventos e identificadores idempotentes |
| `administration` | manutenção, usuários, homologação e ações operacionais | `api/admin/`, rotas do servidor, dashboard | ações privilegiadas auditadas e separadas do tráfego público |
| `frontend-shell` | roteamento, layout, sessão visual e composição de módulos | `src/App.jsx`, `src/router`, `src/components`, `src/modules` | consumir APIs/contratos; não acessar service role ou regras de servidor |

## Capacidades compartilhadas

Estas capacidades não são domínios de negócio e devem ficar atrás de ports/adapters:

- banco de dados;
- cache;
- filas;
- object storage;
- modelos de IA;
- e-mail e mensagens;
- observabilidade;
- relógio e geração de IDs;
- feature flags;
- secrets e configuração.

## Regras de dependência

```text
interfaces/runtime
        ↓
application/use-cases
        ↓
domain

infrastructure/adapters
        ↑ implements ports declared by application/domain
```

Regras:

1. `domain` não importa Supabase, Cloudflare, OpenAI, Express, Hono ou SDKs de terceiros.
2. `application` coordena casos de uso e transações, mas não conhece detalhes de transporte.
3. `interfaces` traduz HTTP, webhook, queue e WebSocket em comandos tipados.
4. `infrastructure` implementa persistência e integrações.
5. integrações entre domínios usam casos de uso ou eventos versionados, nunca acesso cruzado direto a tabelas.

## Contratos que devem permanecer distintos

### Pedido de produto

Campos típicos:

- itens e quantidades;
- preço e totais;
- entrega ou retirada;
- endereço;
- método de pagamento;
- troco quando aplicável.

### Reserva de serviço

Campos típicos:

- serviço;
- pet e tutor;
- data e horário;
- profissional ou recurso;
- duração e capacidade;
- observações;
- estado da confirmação.

Misturar esses contratos é proibido. Dados financeiros de serviço só entram quando um caso de uso explícito de cobrança for acionado.

## Autoridade por estado

| Estado | Autoridade pretendida |
|---|---|
| disponibilidade e bloqueio de agenda | `scheduling` |
| pedido de produto | `orders` |
| reserva de serviço | `service-bookings` |
| pagamento | `payments` |
| mensagem recebida/enviada | `messaging` |
| etapa conversacional | `agents` + máquina de estado da aplicação |
| identidade e tenant | `identity-tenancy` |
| documento fiscal | `fiscal` |

## Ordem inicial de extração

1. contratos compartilhados e erros;
2. identidade/tenant e contexto de requisição;
3. scheduling;
4. orders e service-bookings separados;
5. messaging;
6. agents/Luna/PetBot;
7. fiscal e pagamentos;
8. administração e frontend shell.

A ordem pode mudar por ADR, desde que testes, riscos e rollback sejam registrados.
