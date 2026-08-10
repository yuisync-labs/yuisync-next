# Fase 7 — Canário HTTP de identidade + tenant

## Objetivo

Provar no runtime Cloudflare o pipeline já separado nas etapas anteriores:

```text
HTTP Bearer token
  -> identity provider
  -> provider + subject verificados
  -> D1 tenant membership
  -> principal interno
```

sem abrir nenhum endpoint de negócio e sem ativar o fluxo por padrão.

## Rota

```text
GET /internal/canary/tenant-context
```

Headers:

- `Authorization: Bearer <token>`;
- `x-tenant-id: <tenant interno solicitado>`.

A rota não lê tenant de claim, email, metadata ou body. O header de tenant é somente a seleção de escopo que será revalidada contra o D1.

## Feature flag

A rota só existe funcionalmente quando:

```text
EDGE_IDENTITY_CANARY_ENABLED=true
```

Com a flag ausente ou diferente de `true`, ela retorna o mesmo payload `404 NOT_FOUND` das rotas inexistentes.

Nenhum valor foi adicionado ao `wrangler.jsonc` nesta PR. Portanto o canário continua desabilitado em local, test, staging e qualquer deploy existente até configuração explícita posterior.

## Dependências exigidas quando habilitado

O canário exige simultaneamente:

- `EDGE_DATABASE_ENABLED=true`;
- binding `DB`;
- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY`.

Se a flag do canário estiver ligada e qualquer dependência estiver ausente, `/ready` passa a responder `not_ready` e a rota canário responde `503`.

O readiness não chama Supabase. Ele apenas valida configuração e continua usando o canário D1 já existente para a dependência de banco.

## Respostas

### 200

Identidade verificada e membership ativa:

```json
{
  "status": "ok",
  "tenant_id": "...",
  "principal_id": "...",
  "identity_provider": "supabase"
}
```

O response não devolve bearer token, subject externo, email ou claims.

### 401

Bearer ausente/malformado ou token rejeitado pelo provider.

### 403

Identidade válida sem autorização no tenant solicitado.

A razão interna (`tenant_not_found`, `membership_not_found`, etc.) não é exposta.

### 400

Tenant ausente ou identificador rejeitado pela boundary de tenant.

### 503

Canário habilitado mas não configurado, Auth provider indisponível ou D1 indisponível.

## Logs

Eventos novos:

- `edge.identity_canary.not_ready`;
- `edge.identity_canary.not_configured`;
- `edge.identity_canary.resolved`;
- `edge.identity_canary.unavailable`.

Não são logados:

- bearer token;
- authorization header;
- Supabase subject;
- principal ID;
- tenant ID;
- email/claims.

O evento de sucesso registra apenas provider, request ID e environment.

## Testes

O slice testa em workerd:

- feature flag desligada -> `404`;
- canário ligado sem configuração -> `/ready` `503`;
- pipeline completo com Auth stub + D1 real de teste -> `200`;
- subject verificado sem membership -> `403` genérico;
- configuração da feature exige DB + database flag + provider config.

O teste de sucesso persiste tenant, principal e membership no D1 de teste, substitui apenas o `fetch` do Auth provider e chama a rota Hono real.

## Restrições

- não alterar `main`;
- não configurar staging/produção;
- não adicionar secrets ao repositório;
- não migrar login do frontend;
- não criar endpoint de cliente/agendamento/venda;
- não importar usuário real;
- não ativar feature flag;
- não usar service role;
- não expor a rota como mecanismo oficial de autenticação.

## Próximo gate

Depois desta PR integrada, a ativação real do canário deve ser uma operação separada e reversível:

1. provisionar uma pequena projeção de tenant/principal/membership de teste;
2. definir `SUPABASE_URL` e publishable key via configuração segura do ambiente;
3. habilitar somente no ambiente escolhido;
4. chamar a rota com usuário/tenant de teste;
5. observar latência e erros;
6. desligar a flag imediatamente se houver regressão.

Só depois desse canário real devemos conectar identidade a `settings` ou a qualquer endpoint de domínio.
