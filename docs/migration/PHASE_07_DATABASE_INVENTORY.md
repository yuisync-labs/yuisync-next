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
  -> definir estratégia futura D1/DO/Queue
```

## Baseline confirmado

O webhook atual `serverless/whatsappWebhook.ts` cria um cliente Supabase administrativo usando:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `@supabase/supabase-js`.

Esse cliente executa leituras e escritas diretamente e, por usar service role, não deve ser tratado como evidência de isolamento por RLS. O isolamento precisa ser comprovado explicitamente em cada acesso antes da migração.

## Tabelas confirmadas no webhook

| Tabela | Operações observadas | Tenant boundary observada | Dados relevantes | Destino provável |
| --- | --- | --- | --- | --- |
| `tenants` | `SELECT` | resolução do tenant ativo/fallback | `id`, `active` | D1 tenant registry |
| `clients` | `SELECT`, `UPDATE` | via `session.client_id`; tenant não aparece na atualização observada | documento, `details`, nascimento, CEP, endereço | D1 customers, após validar ownership |
| `chat_sessions` | `SELECT`, `INSERT`, `UPDATE` | consulta de sessão usa `tenant_id` + `module_id` + telefone | telefone, nome, status, contexto, CSAT, vínculo com cliente | D1 conversations/session metadata |
| `chat_messages` | `SELECT`, `INSERT`, `UPDATE` | acesso por `session_id`; depende do ownership da sessão | conteúdo de mensagem, metadata, tokens, timestamps | D1 metadata + storage/RAG conforme retenção futura |
| `sales` | `UPDATE` | atualização observada por identificador da venda; tenant precisa ser auditado | status de pagamento, metadata de comprovante | D1 orders/payments após contrato determinístico |
| `service_delivery_orders` | `UPDATE` | atualização observada por `sale_id`; tenant precisa ser auditado | status e metadata de comprovante | D1 service/order projection após definição de domínio |

Nenhuma RPC Supabase foi encontrada no webhook analisado até este ponto.

## Fluxos de dados sensíveis confirmados

O webhook processa ou persiste dados que exigem classificação explícita antes da migração:

- telefone e nome do cliente;
- documento do tutor;
- data de nascimento;
- CEP;
- número e referência de endereço;
- conteúdo integral de mensagens;
- metadata de WhatsApp;
- metadata de comprovante de pagamento;
- contexto de sessão e CSAT.

A nova arquitetura não deve copiar automaticamente esses campos para Durable Objects, logs, filas ou eventos. Cada domínio precisará definir minimização, retenção e finalidade.

## Riscos já identificados

### Service role no caminho do webhook

O acesso administrativo pode ignorar políticas de RLS. Portanto, uma query que funciona hoje não prova que a aplicação esteja aplicando `tenant_id` em todas as mutações.

### Resolução implícita de tenant

Quando `WHATSAPP_TENANT_ID` não está configurado, o webhook tenta inferir o tenant a partir da tabela `tenants`. Isso é aceitável apenas como comportamento legado documentado; a arquitetura nova deve resolver tenant de forma explícita e determinística a partir da integração/credencial receptora.

### Mutações por ID sem tenant visível

As operações observadas em `clients`, `sales` e `service_delivery_orders` precisam de auditoria completa para confirmar ownership antes de qualquer porta D1 equivalente. Na nova arquitetura, IDs não devem substituir a boundary de tenant.

### Conversas e mensagens

`chat_messages` é consultada por `session_id`. O isolamento depende de a sessão ter sido resolvida corretamente. A futura porta deve carregar tenant no contrato ou usar um identificador interno que tenha ownership comprovado.

### Pagamento e coordenação

O recebimento de comprovante atual atualiza mais de uma projeção de negócio. A migração não deve reproduzir isso como várias escritas livres. O desenho futuro deve definir uma transição determinística, escrita idempotente em D1 e evento versionado; Durable Objects serão usados somente quando houver necessidade real de coordenação concorrente.

## Regras para o inventário completo

Para cada acesso encontrado no restante do repositório, registrar:

1. arquivo e função chamadora;
2. tabela/RPC/storage acessado;
3. `SELECT` / `INSERT` / `UPDATE` / `DELETE` / RPC;
4. filtro de `tenant_id` ou mecanismo equivalente;
5. chave de idempotência, se existir;
6. dados sensíveis lidos/escritos;
7. dependência de ordenação ou transação;
8. consumidor do resultado;
9. risco de migração;
10. destino futuro provável: D1, Durable Object, Queue, R2, Vectorize ou permanência temporária no legado.

## Restrições da fase

- não criar tabela de cliente/agendamento/venda no D1 nesta PR;
- não mover dados reais;
- não alterar credenciais Supabase;
- não alterar webhook de produção;
- não alterar fluxo de atendimento;
- não remover RLS nem service role do legado nesta fase;
- não tocar `main`;
- nenhuma operação de produção.

## Próximos passos do inventário

- localizar os demais clientes Supabase no frontend, server e serverless;
- mapear todas as ocorrências de `.from(...)`, `.rpc(...)`, Storage e Auth com acesso a dados de negócio;
- inventariar SQL/migrations legadas, se presentes no repositório;
- identificar constraints e índices que o código pressupõe;
- separar tabelas de identidade/configuração, catálogo, agenda, pedidos, conversas e observabilidade;
- classificar quais dados devem ou não ser copiados para o novo D1;
- somente depois propor o primeiro modelo relacional real.

## Gates

- [x] branch criada sobre o merge validado da Fase 6;
- [x] cliente Supabase administrativo do webhook identificado;
- [x] tabelas usadas pelo webhook listadas;
- [x] dados sensíveis iniciais classificados;
- [x] riscos iniciais de tenant boundary documentados;
- [ ] todos os clientes Supabase do repositório identificados;
- [ ] todas as tabelas/RPCs/storage/auth mapeadas;
- [ ] constraints e índices legados relevantes mapeados;
- [ ] ownership de tenant de cada escrita classificado;
- [ ] matriz legado -> destino futuro concluída;
- [ ] CI final verde;
- [ ] inventário revisado antes de qualquer schema de negócio no D1.
