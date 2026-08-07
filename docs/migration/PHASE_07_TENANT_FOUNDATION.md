# Fase 7 — Tenant foundation no D1

## Objetivo

Criar o primeiro slice relacional real da migração: registry de tenants, projeção mínima de identidade e memberships, sem migrar autenticação nem qualquer domínio de negócio.

A boundary fica:

```text
provedor de identidade (temporariamente Supabase Auth)
  -> valida token/identidade
  -> produz { provider, subject }
  -> backend recebe tenant solicitado
  -> D1 resolve principal projetado
  -> D1 exige tenant ativo + principal ativo + membership ativa
  -> somente então um use case tenant-scoped pode executar
```

O `tenantId` enviado pelo cliente é apenas uma seleção de escopo. Ele nunca é autoridade.

## Schema

### `tenants`

Registry interno do tenant.

Campos iniciais:

- `id`: identificador interno estável;
- `slug`: identificador legível/roteável, único e normalizado para lowercase;
- `name`: nome de exibição;
- `status`: `active | inactive`;
- timestamps em milissegundos.

### `identity_principals`

Projeção mínima de uma identidade já autenticada externamente.

Campos iniciais:

- `id`: identificador interno do principal;
- `provider`: provedor de identidade, por exemplo `supabase`;
- `subject`: subject/ID retornado pelo provedor após validação;
- `display_name` e `email`: projeções opcionais para UX/auditoria;
- `status`: `active | inactive`;
- timestamps.

A combinação `(provider, subject)` é única.

**Não entram no D1:** senha, access token, refresh token, service role, segredo OAuth ou qualquer credencial do provedor.

### `tenant_memberships`

Relaciona um principal interno a um tenant interno.

- PK composta `(tenant_id, principal_id)`;
- FKs reais para `tenants` e `identity_principals`;
- status `active | inactive`;
- índices tenant-first e principal-first.

A membership desta fase responde apenas “esta identidade pode pertencer a este tenant?”. Roles e permissões de módulos permanecem fora deste slice para não cristalizar prematuramente o modelo legado `allowed_modules/module_permissions`.

## Authorization port

`server/application/ports/tenantAuthorization.ts` define um contrato independente de D1.

O adapter Cloudflare `D1TenantAuthorizationAdapter` recebe:

```text
{ authProvider, authSubject, tenantId }
```

E retorna uma decisão explícita.

Razões de negação:

- `tenant_not_found`;
- `tenant_inactive`;
- `identity_not_found`;
- `identity_inactive`;
- `membership_not_found`;
- `membership_inactive`.

Falha de binding/banco não vira decisão de acesso: gera erro de dependência e o chamador deve falhar fechado.

## Decisões de segurança

1. nenhum tenant vindo de header/body/query é confiável por si só;
2. autorização server-side usa membership persistida;
3. não existe fallback sem tenant;
4. não existe `company sem tenant` no novo modelo;
5. tenant/principal/membership inativos negam acesso;
6. FKs são `RESTRICT`, evitando exclusão silenciosa de ownership;
7. provider/subject são separados do ID interno para permitir trocar o provedor de Auth no futuro;
8. roles de módulo serão uma camada posterior sobre a membership, não substituto da membership.

## Cloudflare/D1

O D1 aplica foreign keys por padrão. A migration usa FKs reais em `tenant_memberships` e não depende de RLS do Postgres.

A ausência de RLS no SQLite/D1 é deliberada: isolamento passa a ser responsabilidade explícita do application layer + queries tenant-scoped, com testes de autorização e ownership.

## Testes do slice

Cobertura obrigatória:

- tenant inexistente -> deny;
- tenant inativo -> deny;
- identidade inexistente -> deny;
- identidade inativa -> deny;
- membership ausente -> deny;
- membership inativa -> deny;
- membership de outro tenant -> deny;
- tenant + identidade + membership ativos -> allow;
- binding D1 ausente -> dependency error/fail closed;
- FK impede membership órfã;
- migrations chegam ao schema version `3`.

## Fora de escopo

- trocar Supabase Auth;
- validar JWT dentro do edge-api;
- importar tenants/usuários reais;
- migrar `settings`;
- roles/permissões por módulo;
- clients/pets;
- endpoints públicos de negócio;
- dual-write;
- qualquer alteração em produção ou `main`.

## Próximo slice

Depois desta foundation estar integrada e verde:

1. definir a porta de autenticação/identity verification que adapta Supabase Auth sem vazá-lo para os use cases;
2. introduzir settings mínimos tenant/module-scoped;
3. só então iniciar clients/pets.

Não criar um schema monolítico antecipando vendas, agenda, fiscal ou chat.
