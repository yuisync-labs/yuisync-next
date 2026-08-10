# Fase 7 — Boundary de verificação de identidade

## Objetivo

Separar autenticação do provedor de identidade da autorização de tenant já persistida no D1.

Este slice não troca o Supabase Auth. Ele impede que Supabase, JWT e detalhes do provider vazem para os use cases.

```text
Authorization: Bearer <opaque token>
  -> parser Bearer
  -> IdentityVerificationPort
  -> adapter do provider de identidade
  -> { provider, subject } verificados
  -> TenantAuthorizationPort
  -> tenant ativo + principal ativo + membership ativa
  -> TenantPrincipalContext
```

## Regra principal

Autenticação e autorização são boundaries diferentes:

- o provider de identidade prova quem é o usuário;
- o D1 decide se essa identidade possui acesso ao tenant solicitado;
- o `tenantId` enviado pelo cliente nunca é autoridade;
- nenhum use case de negócio recebe token bruto nem cliente Supabase.

## `IdentityVerificationPort`

`server/application/ports/identityVerification.ts` define:

```text
access token opaco
  -> authenticated + { provider, subject }
  -> ou invalid_token
```

Falhas do provider não são convertidas em `invalid_token`. Adapter indisponível, timeout, resposta inesperada ou erro de rede são falhas de dependência e devem falhar fechado.

## Adapter transitório do Supabase

`apps/edge-api/src/adapters/supabaseIdentityVerifier.ts` implementa a porta usando o endpoint Auth `/auth/v1/user`.

Motivação:

- o projeto atual ainda não teve o algoritmo/chave de assinatura confirmado neste slice;
- projetos Supabase com signing key assimétrica podem verificar JWT localmente via JWKS;
- projetos legados com shared secret HS256 precisam de verificação server-side no Auth server;
- usar `/auth/v1/user` mantém compatibilidade sem assumir o modo de assinatura.

O adapter usa somente:

- URL do projeto;
- publishable/anon key apropriada para o cliente;
- bearer token recebido na requisição.

**Não usa service role.**

O adapter:

- aceita somente HTTPS, exceto localhost para desenvolvimento;
- limita tamanho/formato do token;
- envia `apikey` + `Authorization: Bearer ...` ao Auth server;
- trata `401/403` como token inválido;
- trata `429/5xx`, timeout e falha de rede como dependência indisponível;
- exige `user.id` válido na resposta;
- retorna `{ provider: 'supabase', subject: user.id }`;
- não retorna email/perfil como autoridade;
- não inclui token nas mensagens de erro.

## Evolução para JWKS

Quando o projeto estiver confirmado/migrado para signing keys assimétricas:

```text
IdentityVerificationPort
  -> SupabaseJwksIdentityVerifier
```

pode substituir o adapter remoto sem alterar:

- use cases;
- tenant authorization;
- D1 schema;
- contratos de domínio.

A validação local via JWKS reduz o round-trip regional do Auth server e deve ser preferida após a confirmação das signing keys e da estratégia de rotação/cache.

## Bearer parser

`apps/edge-api/src/auth/bearerToken.ts`:

- aceita `Bearer` case-insensitive;
- exige um único token;
- distingue header ausente de header malformado;
- limita o tamanho antes de passar o valor à porta de identidade.

O parser não decodifica JWT e não decide autorização.

## Composição de aplicação

`server/application/services/resolveTenantPrincipal.ts` combina as duas portas.

Resultados externos mínimos:

- `unauthenticated`: identidade não pôde ser autenticada;
- `forbidden`: identidade válida, mas sem autorização no tenant;
- `resolved`: devolve `tenantId`, `principalId` interno e identidade verificada.

As razões internas detalhadas de membership não precisam ser expostas a uma futura rota HTTP.

## Segurança

1. token é opaco fora do adapter de identidade;
2. nenhum token é persistido no D1;
3. nenhum token entra em log por design;
4. service role não é necessária para validar usuário;
5. email, metadata ou claims fornecidos pelo cliente não são usados como identidade;
6. `subject` só é aceito após resposta válida do provider;
7. autorização sempre passa pela membership do D1;
8. outages de Auth/D1 falham fechado;
9. uma futura rota deve mapear `unauthenticated -> 401`, `forbidden -> 403` e dependência indisponível -> `5xx/503`, sem vazar detalhes.

## Testes do slice

Cobertura adicionada para:

- bearer ausente, malformado e válido;
- token inválido `401/403`;
- token localmente malformado sem chamada externa;
- resposta Auth válida -> provider/subject;
- `429/5xx` -> dependency error;
- falha de rede -> dependency error sem token na mensagem;
- payload `200` inválido -> protocol error;
- HTTP remoto inseguro rejeitado, localhost permitido;
- identidade inválida não consulta membership;
- identidade válida passa somente provider/subject verificados ao tenant authorization;
- membership negada -> `forbidden`;
- falhas de identidade/tenant authorization são propagadas e nunca concedem acesso.

## Fora de escopo

- trocar Supabase Auth;
- alterar login do frontend;
- criar endpoint protegido no edge-api;
- adicionar secrets/bindings obrigatórios ao Worker;
- confirmar/migrar signing keys do projeto;
- JWKS cache/rotação;
- importar identities/memberships reais;
- roles/permissões por módulo;
- settings/clients/pets;
- produção ou `main`.

## Próximo slice

Depois desta boundary estar verde e integrada:

1. introduzir a composição HTTP protegida no edge de forma feature-flagged ou canário, sem domínio de negócio;
2. definir/provisionar as projeções reais de tenant/identity necessárias para migração;
3. adicionar `settings` mínimos tenant/module-scoped;
4. então iniciar clients/pets.
