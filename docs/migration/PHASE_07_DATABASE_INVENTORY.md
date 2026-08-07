# Fase 7 — Inventário do banco legado

## Objetivo

Mapear com precisão os acessos ao banco atual antes de desenhar as tabelas de negócio no D1. Esta fase é somente de descoberta e classificação: não migra dados, não troca o Supabase e não ativa novos fluxos.

```text
código legado
  -> localizar cliente/driver de banco
  -> identificar tabela ou RPC
  -> classificar leitura/escrita
  -> registrar tenant boundary
  -> registrar dados sensíveis
  -> registrar dependências de transação/concorrência
  -> definir estratégia futura D1/DO/Queue/R2/Vectorize
```

## Escopo auditado e fonte de verdade

O inventário cobre os caminhos ativos que sustentam hoje o PetShop, dashboard, WhatsApp/PetBot, checkout, agenda, fiscal e a Edge Function de chat legada.

A pasta `database/` é arquivo histórico. O próprio repositório define como fonte de verdade incremental o marcador de produção `supabase/migrations/20260720000000_live_baseline.sql` e as migrações posteriores em `supabase/migrations/`. Arquivos de `database/` só entram neste inventário quando descrevem objetos anteriores ao baseline que ainda são chamados pelo runtime atual.

Isto evita dois erros:

- tratar `database/DATABASE.sql` como se fosse o schema atual;
- copiar para D1 estruturas antigas que já foram endurecidas ou substituídas pelas migrações atuais.

## Clientes Supabase confirmados

| Entrada | Credencial/contexto | Uso | Implicação de migração |
| --- | --- | --- | --- |
| `serverless/whatsappWebhook.ts` | `SUPABASE_SERVICE_ROLE_KEY` | webhook WhatsApp/PetBot | service role ignora RLS; todo ownership precisa ser revalidado no novo contrato |
| `server/lib/supabase.js` | service role + cliente com JWT do usuário | backend Node | separar operações administrativas de operações tenant-scoped autenticadas |
| `src/lib/supabase.js` | anon/publishable key + sessão Supabase Auth | frontend | acesso depende de Auth + RLS; frontend não deve falar diretamente com D1 |
| `supabase/functions/_shared/supabaseClient.ts` | `SUPABASE_SERVICE_ROLE_KEY` | Edge Function legada | caminho administrativo paralelo; migrar/aposentar explicitamente, nunca copiar fallbacks permissivos |

Não foi identificado outro provider central necessário aos fluxos ativos auditados. Novas ocorrências devem reutilizar um desses providers ou ser tratadas como exceção arquitetural.

## Auth, Realtime e Storage

### Auth

O frontend usa Supabase Auth para:

- `getSession`;
- `onAuthStateChange`;
- `signInWithPassword`;
- `signOut`.

O backend valida o JWT com `adminSupabase.auth.getUser(accessToken)` e carrega `profiles`/`profile_tenants` para autorização de aplicação.

**Decisão para a migração:** identidade/autenticação é uma boundary separada do D1 operacional. O primeiro schema D1 não deve armazenar senha, refresh token ou tentar reproduzir `auth.users`. Enquanto a substituição de identidade não for uma fase explícita, Supabase Auth pode permanecer temporariamente atrás de uma porta de autenticação.

### Realtime

A agenda usa Supabase Realtime (`postgres_changes`) para invalidar/recarregar appointments. O schema histórico também publicou chat sessions/messages no Realtime.

**Decisão para a migração:** Realtime é transporte, não responsabilidade do D1. O novo runtime deve emitir/consumir sinais explícitos por Worker/DO/evento conforme o caso, sem modelar publicação do Postgres como tabela de domínio.

### Storage

Nenhuma dependência de `supabase.storage` foi confirmada nos caminhos ativos auditados. O banco guarda referências como `image_url`, `xml_url`, `pdf_url` e `invoice_nfe_url`.

**Decisão para a migração:** R2 é candidato para artefatos binários/arquivos que passarem a ser de responsabilidade do YuiSync — por exemplo XML/PDF fiscal ou mídia própria — mas a URL existente não deve ser copiada para R2 automaticamente.

## Tenant boundary atual

A migração `20260720001000_tenant_security_hardening.sql` é a principal referência de isolamento atual. Ela:

- introduz/propaga `tenant_id` em mensagens de chat;
- define `has_tenant_access(tenant_id)`;
- bloqueia reassignment de tenant por usuários normais;
- força `tenant_id NOT NULL` nas tabelas operacionais auditadas;
- cria índice por `tenant_id`;
- recria RLS por tenant para SELECT/INSERT/UPDATE/DELETE.

### Tabelas explicitamente tenant-scoped no hardening

- `settings`
- `clients`
- `appointments`
- `products`
- `sales`
- `sale_items`
- `sale_payment_splits`
- `invoices`
- `billing_settings`
- `chat_sessions`
- `chat_messages`
- `accounting_services`
- `subscription_plans`
- `client_subscriptions`
- `loyalty_settings`
- `loyalty_points`
- `commission_rules`
- `cash_register`
- `petshop_campaign_logs`
- `service_delivery_orders`
- `fiscal_documents`
- `tenant_fiscal_profiles`
- `petshop_growth_booking_requests`
- `petshop_growth_settings`
- `petshop_growth_report_cards`

Migrações posteriores adicionam/fortalecem outros objetos tenant-scoped, principalmente `pets`, `stock_movements`, filas/erros fiscais e objetos de agenda/pacotes.

## Inventário por domínio

### Identidade, tenancy e plataforma

| Objeto | Operações observadas | Boundary | Destino provável |
| --- | --- | --- | --- |
| `auth.users` | Auth gerenciado pelo Supabase | identidade | manter temporariamente fora do D1 até fase própria |
| `profiles` | SELECT/UPDATE; gestão administrativa | usuário + memberships | D1 apenas para projeção/autorização da aplicação, nunca credenciais |
| `tenants` | SELECT/INSERT | global/admin | D1 tenant registry |
| `profile_tenants` | SELECT/UPSERT/DELETE | profile + tenant | D1 membership/authorization |
| `platform_plan_catalog` | SELECT/global admin | global | D1 catálogo de planos |
| `tenant_subscriptions` | SELECT | tenant + module | D1 assinatura/entitlements |
| `tenant_ai_usage_monthly` | leitura/escrita atômica via RPC | tenant + module + mês | D1 metering; comando atômico |

O `AuthContext` ainda possui fallback de tenants em `localStorage` quando o schema/membership não está disponível. Esse mecanismo é UX/bootstrap legado e **não pode ser fonte de autorização do servidor**.

### Clientes e pets

| Objeto | Operações observadas | Risco/invariante | Destino provável |
| --- | --- | --- | --- |
| `clients` | SELECT/INSERT/UPDATE/DELETE | PII; sempre exigir tenant + module | D1 customer/tutor |
| `pets` | UPSERT/SELECT | vínculo histórico por mesmo ID/telefone; um upsert do frontend não inclui `tenant_id` explicitamente | D1 pet, com ownership obrigatório |

Dados sensíveis: nome, CPF/CNPJ, telefone, email, endereço, bairro, cidade, CEP, data de nascimento, referência de endereço e atributos do animal.

### Catálogo, estoque e serviços

| Objeto | Operações observadas | Risco/invariante | Destino provável |
| --- | --- | --- | --- |
| `products` | CRUD, soft delete, leitura de estoque | estoque não pode depender de read-modify-write do browser | D1 catálogo/inventory |
| `petshop_services` | catálogo de serviços e snapshots para agenda | preço/duração devem vir do catálogo autorizado | D1 service catalog |
| `stock_movements` | append em transações de venda | ledger/auditoria; single-writer | D1 inventory ledger |

A UI ainda possui ajuste de estoque por leitura seguida de UPDATE. Esse padrão é race-prone e não deve existir na API nova. Toda mutação de estoque deve entrar por comando determinístico/idempotente no backend.

Existe também sincronização histórica `products -> petshop_services` por trigger. No novo domínio, a relação deve ser explícita; não copiar triggers implícitos sem contrato.

### Agenda, planos de serviço e MotoDog

| Objeto | Operações observadas | Risco/invariante | Destino provável |
| --- | --- | --- | --- |
| `appointments` | SELECT/INSERT/UPDATE/DELETE + Realtime | idempotência, overlap, preço/duração snapshot, responsáveis | D1 agenda |
| `subscription_plans` | SELECT | regras de benefícios | D1 plano de serviços |
| `client_subscriptions` | SELECT/UPDATE | consumo/restauração precisa ser atômico | D1 subscriptions/benefit ledger |
| `service_delivery_orders` | SELECT/INSERT/UPDATE | transporte ligado a serviço/venda | D1 order/transport projection + Queue para efeitos assíncronos |

As migrações atuais implementam:

- idempotência de appointment por `(tenant_id, idempotency_key)`;
- proteção contra sobreposição;
- resolução de múltiplos serviços;
- snapshot de preço/duração/benefício;
- consumo e restauração de benefício;
- classificação banho/tosa versus veterinária;
- endereço e estado operacional do MotoDog.

Essas regras são parte do domínio e precisam ser preservadas antes de cortar tráfego para D1.

### Vendas, pagamentos e checkout

| Objeto | Operações observadas | Risco/invariante | Destino provável |
| --- | --- | --- | --- |
| `sales` | SELECT/INSERT/UPDATE | idempotência, total calculado pelo servidor | D1 sales |
| `sale_items` | INSERT/SELECT | snapshot de preço/quantidade | D1 sale items |
| `sale_payment_splits` | INSERT/SELECT | soma precisa fechar total | D1 payment splits |
| `stock_movements` | INSERT | deve acompanhar venda atomicamente | D1 ledger |

O caminho preferencial atual já passa pelo backend `checkoutPetshop`, que chama `create_pdv_checkout_transaction`. A RPC:

- verifica sessão/tenant;
- exige `idempotency_key`;
- bloqueia produtos;
- valida estoque e preço;
- valida limite de desconto;
- valida pagamento simples/dividido;
- grava venda, itens, split e movimento de estoque na mesma transação.

Essa RPC é uma boa boundary funcional para virar um `CheckoutCommand` do novo backend. Não migrar o fallback `createSaleLegacy` como caminho principal.

### Conversas e mensagens

| Objeto | Operações observadas | Risco/invariante | Destino provável |
| --- | --- | --- | --- |
| `chat_sessions` | SELECT/INSERT/UPDATE | tenant/session ownership; contexto contém estado operacional legado | D1 metadata/session + DO para coordenação ativa |
| `chat_messages` | SELECT/INSERT/UPDATE | conteúdo sensível; ordenação por turno | D1 message metadata/content conforme retenção |

O dashboard usa hoje coordenação no Postgres por:

- `dashboard_message_version`;
- `dashboard_processed_version`;
- `dashboard_processing_token`;
- `dashboard_processing_until`;
- `dashboard_turn_version` em mensagens.

Essa coordenação é implementada pelas RPCs de ingestão/lease/complete/release e existe para serializar invocações serverless. **Não portar essas colunas/RPCs 1:1 para D1**. A Fase 6 já criou a boundary de Durable Objects para lease/fencing/idempotência/ordenação; D1 deve persistir o estado de negócio durável, não ser usado como lock distribuído improvisado.

### Financeiro e fiscal

| Objeto | Operações observadas | Risco/invariante | Destino provável |
| --- | --- | --- | --- |
| `invoices` | CRUD/SELECT | status financeiro + referência fiscal | D1 metadata financeira |
| `billing_settings` | SELECT/UPSERT | tenant + module | D1 configuração |
| `tenant_fiscal_profiles` | SELECT/UPDATE | dados fiscais/série/ambiente | D1 configuração fiscal com acesso restrito |
| `fiscal_documents` | SELECT/UPDATE | payload/resposta/chave/protocolo | D1 metadata + R2 para XML/PDF quando aplicável |
| `fiscal_queue_failures` | INSERT/UPDATE via RPC | retry/auditoria | Queue DLQ + D1 audit projection |
| `fiscal_policy_versions` | SELECT/INSERT global | política global versionada | D1 global catalog/config |
| `fiscal_audit_logs` | leitura/escrita de auditoria | retenção/compliance | D1 ou analytics conforme fase específica |

Emissão fiscal possui efeito externo no Focus NFe. No destino, a requisição deve ser assíncrona/idempotente por Queue, com retry/DLQ; D1 guarda estado e correlação. Segredos do provedor não vão para D1, mensagens ou eventos.

O import de XML de entrada hoje é lido no browser e depois altera estoque/fatura. Esse fluxo deve ganhar command/backend próprio antes de qualquer migração definitiva; raw XML pode ser armazenado em R2 somente se houver requisito explícito de retenção.

### Growth, fidelidade, caixa e comissões

As tabelas tenant-scoped já protegidas no hardening incluem:

- `loyalty_settings`, `loyalty_points`;
- `commission_rules`;
- `cash_register`;
- `petshop_campaign_logs`;
- `petshop_growth_booking_requests`;
- `petshop_growth_settings`;
- `petshop_growth_report_cards`.

Elas permanecem candidatas a D1, mas **não entram no primeiro schema mínimo** sem uma fase que migre seus fluxos consumidores. O inventário registra ownership; não antecipa migração de funcionalidades periféricas.

## Edge Function legada paralela

A pasta `supabase/functions` mantém um caminho de chat anterior/paralelo ao backend principal.

Objetos confirmados:

- `companies`;
- `conversations`;
- `clients`;
- `products`;
- `appointments`;
- `settings`;
- `tenant_subscriptions`;
- `platform_plan_catalog`.

RPCs confirmadas:

- `book_appointment`;
- `yui_consume_ai_quota`.

Riscos específicos:

1. usa service role;
2. `companies.tenant_id` pode ser nulo;
3. governança de plano permite modo `Bootstrap` quando company não possui tenant;
4. `businessContextBuilder` tenta novamente `clients/products` **sem `tenant_id`** quando detecta coluna ausente;
5. `conversations` possui updates por ID em contexto administrativo.

Esse comportamento é legado de compatibilidade. A nova arquitetura deve convergir para tenant explícito e falhar fechado (`fail closed`). Não criar equivalente D1 para `company sem tenant` nem para retry sem tenant.

## RPCs e invariantes que o novo domínio precisa substituir

| RPC/trigger legado | Invariante real | Destino arquitetural |
| --- | --- | --- |
| `create_pdv_checkout_transaction` | checkout idempotente + estoque + pagamentos + ledger | command transacional no backend/D1; eventos após commit |
| `book_petshop_appointment_transaction` | booking idempotente + catálogo + benefício | command de agenda no backend/D1 |
| `update_petshop_appointment_transaction` | edição consistente + restaura/consome benefício | command de agenda no backend/D1 |
| `prevent_appointment_overlap` | exclusão concorrente de slots/recursos | regra de domínio; DO apenas se coordenação cross-request realmente exigir |
| `create_petbot_order_transaction` | serializa webhook, estoque/slot, venda, entrega e contexto | decompor em command idempotente + outbox/eventos; DO coordena conversa/comando quando necessário |
| `ingest_dashboard_chat_message` | ordem/idempotência de mensagens | Durable Object + persistência D1 |
| `acquire_dashboard_chat_turn` | lease/fencing | Durable Object |
| `complete_dashboard_chat_turn` | commit de versão processada | Durable Object + D1 projection |
| `release_dashboard_chat_turn` | liberação de lease | Durable Object |
| `queue_fiscal_document_for_sale` | criação idempotente de trabalho fiscal | Queue + D1 state/outbox |
| `record_fiscal_queue_failure` | retry auditável | DLQ + D1 audit projection |
| `yui_consume_ai_quota` | incremento mensal atômico | D1 metering command; não usar DO por padrão |
| `create_petshop_booking_request` | entrada pública + tenant por slug + rate limit | Worker endpoint + tenant resolver + rate limit/command |

## Constraints e índices que não podem se perder

A migração deve preservar semanticamente, ainda que a implementação mude:

- `tenant_id NOT NULL` em dados operacionais;
- impossibilidade de reassignment silencioso de tenant;
- uniqueness/idempotência por tenant para vendas e agendamentos;
- integridade de membership `profile <-> tenant`;
- FK/ownership de cliente/produto/appointment dentro do tenant;
- estoque nunca negativo por corrida;
- ledger de movimento de estoque;
- prevenção de overlap de agenda conforme recurso/capacidade;
- snapshots históricos de preço, duração, serviço, entrega e benefício;
- soma de split payments igual ao total;
- índices tenant-first para consultas operacionais;
- ordenação monotônica/idempotência do chat;
- correlação única/idempotente de documento fiscal e retries.

O objetivo não é reproduzir cada índice Postgres literalmente em SQLite/D1, e sim preservar a invariável e depois desenhar os índices a partir das queries novas.

## Dados sensíveis e regra de minimização

Classificados como sensíveis/privados no contexto do produto:

- telefone, nome, email e documento;
- data de nascimento;
- endereço, CEP, número e referência;
- conteúdo integral das conversas;
- contexto operacional da sessão;
- metadata de WhatsApp;
- comprovantes/metadados de pagamento;
- payload/resposta fiscal, chave e protocolo;
- dados comerciais de preço/custo/estoque quando tenant-confidenciais.

Regras para a nova arquitetura:

1. Queue recebe IDs e payload mínimo necessário, não dump de linhas/tabelas;
2. Durable Object guarda apenas estado necessário para coordenação ativa;
3. logs nunca recebem segredo, token, documento completo ou conteúdo de chat por padrão;
4. Vectorize não recebe PII/chat bruto por padrão;
5. R2 só guarda artefato com finalidade e retenção definidas;
6. toda porta operacional carrega `tenantId` explicitamente ou usa um ID interno cujo ownership já foi comprovado no mesmo command.

## Matriz legado -> Cloudflare

| Domínio legado | System of record futuro | Coordenação/async | Observação |
| --- | --- | --- | --- |
| tenants/memberships/projeção de perfil | D1 | — | Auth permanece boundary separada inicialmente |
| clients/pets | D1 | — | PII minimizada e tenant obrigatório |
| products/services | D1 | Queue para eventos derivados quando útil | imagens próprias podem ir a R2 |
| inventory/stock_movements | D1 | Queue após commit | single-writer/atomicidade no command |
| appointments/subscription benefits | D1 | DO apenas onde houver concorrência cross-request real | preservar idempotência/overlap/snapshots |
| sales/items/payments | D1 | Queue `sale.*`/efeitos externos | checkout é command determinístico |
| transport/service delivery | D1 | Queue/workflow operacional | projeção derivada de venda/serviço |
| chat sessions/messages | D1 | Durable Object + Queue | DO ordena/coordena; D1 persiste |
| dashboard chat leases | não migrar como tabela | Durable Object | substituição direta da coordenação Postgres |
| invoices/fiscal metadata | D1 | Queue + DLQ | emissão externa assíncrona |
| XML/PDF/anexos próprios | R2 | Queue opcional | somente com retenção definida |
| conhecimento curado para RAG | D1/R2 source + Vectorize index | Queue de indexação | nunca usar Vectorize como primary DB |
| AI quota/metering | D1 | analytics/eventos opcionais | incremento atômico por tenant/período |
| Edge `companies/conversations` | legado temporário até retirada | — | não duplicar modelo nullable-tenant no D1 |

## Ordem recomendada para a migração de dados/domínios

1. identidade projetada, tenants e memberships;
2. settings mínimos por tenant/module;
3. clients/pets;
4. catálogo de produtos/serviços;
5. agenda + subscriptions/benefícios;
6. inventory + checkout/vendas;
7. chat persistence integrado ao DO da Fase 6;
8. transport/delivery;
9. financeiro/fiscal + Queue/R2;
10. growth, fidelidade, comissões e demais projeções periféricas.

Cada corte precisa suportar dual-read/dual-write somente se houver plano explícito de reconciliação. Não introduzir dual-write genérico como solução permanente.

## Restrições da fase

- não criar tabela de cliente/agendamento/venda no D1 nesta PR;
- não mover dados reais;
- não alterar credenciais Supabase;
- não alterar webhook de produção;
- não alterar fluxo de atendimento;
- não remover RLS nem service role do legado nesta fase;
- não tocar `main`;
- nenhuma operação de produção.

## Gates

- [x] branch criada sobre o merge validado da Fase 6;
- [x] providers/clientes Supabase dos caminhos ativos identificados;
- [x] Auth, Realtime e ausência de Storage ativo confirmados nos seams auditados;
- [x] tabelas e RPCs dos fluxos ativos PetShop/WhatsApp/dashboard mapeadas;
- [x] SQL histórico separado da cadeia incremental autoritativa;
- [x] constraints/índices/invariantes legadas relevantes mapeadas;
- [x] ownership/tenant boundary das escritas críticas classificado;
- [x] caminhos service-role e exceções perigosas documentados;
- [x] dados sensíveis e regras de minimização classificados;
- [x] matriz legado -> D1/DO/Queue/R2/Vectorize concluída;
- [x] sequência de migração proposta sem criar schema real;
- [ ] CI final verde;
- [ ] inventário revisado antes de qualquer schema de negócio no D1.

## Critério de saída

A Fase 7 está pronta para sair de draft quando:

1. CI do documento/branch estiver verde;
2. a revisão confirmar que nenhuma boundary crítica do runtime ativo ficou sem classificação;
3. a próxima PR criar somente o **primeiro slice relacional mínimo**, baseado nas invariantes deste inventário — não uma cópia integral do Postgres.
