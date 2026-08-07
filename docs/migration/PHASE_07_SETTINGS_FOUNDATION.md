# Fase 7 — Settings foundation no D1

## Objetivo

Criar o primeiro aggregate de configuração tenant/module-scoped no D1 sem copiar a tabela legada `settings` como um único "God row".

O slice cobre apenas a identidade/configuração base da unidade:

- nome da loja;
- telefone;
- endereço;
- bairro;
- cidade;
- instrução/prompt customizado do tenant para o bot.

Nenhum endpoint público, dual-write ou migração de dados reais é introduzido nesta PR.

## O que o inventário encontrou

O legado `settings` começou pequeno, mas hoje o PetBot lê da mesma linha responsabilidades muito diferentes:

- identidade da loja: `store_name`, `store_phone`, `store_address`, `store_neighborhood`, `store_city`;
- customização do bot: `bot_prompt`;
- entrega/MotoDog: `delivery_fee`, `pet_transport_fee`, `pet_transport_options`;
- pagamento: `pix_key`, `pix_holder_name`;
- autonomia: `petbot_autonomy_mode`, `petbot_autonomy_allowlist`;
- agenda: timezone, horários, duração de slots, antecedência, capacidade;
- veterinária: nome e horários;
- equipe e duração operacional de serviços;
- lembretes;
- templates de mensagem.

Outros settings já são aggregates independentes no legado, como `loyalty_settings`.

Conclusão: copiar a tabela inteira para D1 perpetuaria acoplamento entre domínios. A migração será decomposta em configurações tipadas por responsabilidade.

## Novo aggregate: `tenant_module_settings`

Chave:

```text
(tenant_id, module_id)
```

Campos deste primeiro slice:

- `store_name`;
- `store_phone`;
- `store_address`;
- `store_neighborhood`;
- `store_city`;
- `bot_prompt`;
- `version`;
- timestamps.

### Tenant isolation

- `tenant_id` é obrigatório;
- FK para `tenants(id)` com `RESTRICT`;
- não existe fallback sem tenant;
- toda query do adapter usa simultaneamente `tenant_id` e `module_id`;
- o adapter não recebe `principalId` porque autorização continua sendo responsabilidade da boundary anterior (`TenantAuthorizationPort` / `TenantPrincipalContext`).

### Module identity

`module_id` é normalizado para lowercase e limitado a um identificador simples.

Não existe FK para um catálogo de módulos neste slice porque o catálogo/entitlements ainda não foi migrado. A validação server-side impede path-like ou identificadores arbitrários malformados.

## Concorrência

A linha possui `version` para optimistic concurrency.

### Create

```text
expectedVersion = null
```

Só cria se `(tenant_id, module_id)` ainda não existir. Se já existir, retorna `conflict` e não sobrescreve nada.

### Update

```text
expectedVersion = versão lida
```

O `UPDATE` inclui a versão no `WHERE` e incrementa `version` atomicamente. Um save atrasado recebe `conflict`.

Isso evita last-write-wins silencioso quando mais de uma tela/processo editar settings.

## Port de aplicação

`server/application/ports/moduleSettings.ts` define:

- `getBaseSettings(tenantId, moduleId)`;
- `saveBaseSettings(...)`;
- `saved | conflict` como resultado explícito.

O port não conhece Supabase, D1, Hono ou frontend.

## Adapter D1

`apps/edge-api/src/adapters/d1ModuleSettings.ts`:

- usa prepared statements;
- normaliza `tenantId` e `moduleId`;
- aplica limites de tamanho antes do banco;
- nunca faz query somente por `module_id`;
- não faz upsert destrutivo;
- diferencia create/update por `expectedVersion`;
- falha fechado se o binding D1 estiver ausente/indisponível.

## Dados explicitamente fora desta tabela

### MotoDog / entrega

Ficam para um aggregate tipado próprio, porque opções, preços e disponibilidade formam uma regra operacional, não identidade básica da unidade.

### Agenda

Timezone, business hours, slot interval, lead time, capacidade e lembretes ficam para configuração tipada de scheduling.

### PIX/pagamento

`pix_key` e `pix_holder_name` não entram neste aggregate base. Pagamentos terão boundary própria e política de acesso/mascaramento.

### Autonomia do PetBot

`petbot_autonomy_mode` e allowlist são controles operacionais de rollout, não dados básicos da loja. A allowlist ainda contém telefone/PII e não deve ser copiada por conveniência.

### Equipe/templates

`petshop_operational_staff`, `message_templates` e duração de serviços permanecem fora. Equipe e catálogo possuem ownership próprio.

### Fidelidade

`loyalty_settings` já é um aggregate separado e continuará sendo migrado separadamente.

## `bot_prompt`

`bot_prompt` entra neste primeiro slice porque é customização textual tenant/module-scoped usada junto da identidade da loja.

Regras:

- máximo de 12.000 caracteres neste foundation;
- tratado como conteúdo/configuração do tenant, nunca como credencial;
- não concede autorização nem altera tenant context;
- secrets/tokens não devem ser colocados nele;
- a futura composição de prompt deve continuar aplicando regras de sistema e guardrails acima dessa customização.

## Testes

Cobertura obrigatória do slice:

- migration chega ao schema version `4`;
- tabela existe no D1 real de teste;
- create + read por tenant/module;
- outro tenant não enxerga a linha;
- outro módulo não enxerga a linha;
- create repetido retorna `conflict` e não sobrescreve;
- update parcial preserva campos não enviados;
- update incrementa `version`;
- update com versão antiga retorna `conflict`;
- FK impede settings órfãos;
- binding D1 ausente falha fechado;
- `module_id` inválido é rejeitado antes da query.

## Fora de escopo

- conectar frontend ao D1;
- substituir o carregamento legado do PetBot;
- dual-read/dual-write;
- importar settings reais;
- endpoint HTTP de settings;
- habilitar identity canary;
- MotoDog/agenda/PIX/autonomia/equipe/lembretes;
- alterar staging/produção;
- alterar `main`.

## Próximo passo

Depois deste foundation integrado:

1. definir como a projeção inicial de tenant/identity/settings será importada de forma idempotente;
2. criar um endpoint interno/protegido somente quando o `TenantPrincipalContext` puder guardá-lo;
3. migrar configurações operacionais em aggregates tipados, começando pelas necessárias ao primeiro domínio que sair do Supabase;
4. então avançar para `clients/pets` conforme a ordem da Fase 7.
