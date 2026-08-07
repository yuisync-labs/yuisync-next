# Fase 7 — Transport staging da foundation

## Objetivo

Criar um transport HTTP estreito para o writer `phase7-foundation/v1`, mas mantê-lo **desligado por padrão e sem configuração de deploy nesta PR**.

O código passa a suportar conceitualmente:

```text
snapshot Supabase já extraído/projetado
  -> POST interno protegido
  -> D1FoundationWriter
  -> D1 staging
```

Porém nenhuma flag ou secret é adicionada ao `wrangler.jsonc`. Portanto a integração do PR, por si só, não habilita escrita em nenhum ambiente.

## Endpoint

```text
POST /internal/migration/foundation
```

O endpoint só deixa de se comportar como `404 NOT_FOUND` quando **as duas condições** são verdadeiras:

```text
APP_ENV=staging
EDGE_FOUNDATION_MIGRATION_ENABLED=true
```

Assim:

- local -> 404;
- test -> 404;
- production -> 404 mesmo se a flag for ligada por engano;
- staging com flag ausente/false -> 404.

## Configuração exigida quando habilitado

Além de `APP_ENV=staging`, o gate exige:

- `EDGE_DATABASE_ENABLED=true`;
- binding `DB` disponível;
- `FOUNDATION_MIGRATION_TOKEN` server-side com comprimento mínimo defensivo.

Se a flag for explicitamente habilitada e qualquer dependência estiver ausente, `/ready` passa a `not_ready` e o transport responde `503`.

Nenhum valor para `EDGE_FOUNDATION_MIGRATION_ENABLED` ou `FOUNDATION_MIGRATION_TOKEN` é configurado nesta PR.

## Autorização

O caller envia:

```text
x-yuisync-migration-token: <secret>
```

O token esperado existe somente como binding server-side.

A comparação:

- valida a configuração do secret;
- calcula SHA-256 dos dois valores;
- compara os digests sem retornar no primeiro byte diferente;
- também exige comprimento idêntico.

O header/token nunca é registrado nos logs e nunca é devolvido na resposta.

Esta autorização é específica para tooling operacional de migração e não substitui autenticação de usuários/tenants.

## Limite do request

O transport aceita somente:

```text
Content-Type: application/json
```

O body é limitado a:

```text
256 KiB
```

A checagem usa:

1. `Content-Length`, quando presente;
2. tamanho real do `ArrayBuffer` após leitura.

Isso protege contra snapshots excessivamente grandes antes de entregá-los ao writer.

O writer mantém, adicionalmente, seu limite independente de 48 statements atômicos.

## Input

O body é o snapshot semântico bruto produzido pela source projection:

```text
projection = phase7-foundation/v1
source.system = supabase
```

O transport não aceita:

- SQL;
- nome de tabela;
- target environment;
- binding de D1;
- comandos Wrangler;
- destination snapshot;
- projection arbitrária.

Toda validação estrutural continua sendo feita novamente pelo `D1FoundationWriter`.

## Respostas

### 200

O writer aplicou a foundation ou confirmou que ela já estava idêntica.

Resposta inclui somente:

- `request_id`;
- contagens de identities/memberships;
- presença de settings;
- quantidade de statements.

Não inclui snapshot, email, tenant ID, subject externo ou token.

### 400

JSON/snapshot inválido.

### 401

Token de migração inválido.

### 409

Destination existente diverge da source projection. O writer não sobrescreve.

### 413

Body ou foundation excede os limites deste transport/writer.

### 415

Content-Type diferente de JSON.

### 503

Feature explicitamente habilitada em staging, mas D1/secret/configuração não está disponível.

## Observabilidade

Eventos específicos:

```text
edge.foundation_migration.not_ready
edge.foundation_migration.not_configured
edge.foundation_migration.unauthorized
edge.foundation_migration.applied
edge.foundation_migration.rejected
```

Os eventos podem incluir:

- request ID;
- environment;
- contagens;
- error code sanitizado.

Não incluem:

- token;
- snapshot;
- tenant ID;
- principal ID;
- subject;
- email;
- bot prompt;
- SQL ou bound values.

## Readiness

`/ready` ganha o check:

```text
foundation_migration
```

Estados:

- `disabled`;
- `configured`;
- `not_configured`;
- `wrong_environment`.

Quando a feature está desligada, ela não afeta readiness.

Quando explicitamente ligada, uma configuração inválida faz o Worker falhar fechado em readiness.

## Testes em workerd

A suíte prova:

- flag desligada -> 404;
- flag ligada fora de staging -> 404;
- feature staging sem secret -> 503;
- token incorreto -> 401 e zero escrita;
- Content-Type incorreto -> 415;
- body acima de 256 KiB -> 413;
- snapshot válido -> 200 + escrita D1 real de teste;
- rerun idêntico -> 200 sem mudar `version`/timestamps;
- divergência -> 409 e destination preservado;
- snapshot incompatível -> 400;
- readiness default continua verde com transport desligado;
- readiness detecta ambiente incorreto e configuração staging válida.

## Rollback e Time Travel

Antes de qualquer **primeira execução real** em D1 staging, o runbook operacional deve capturar um bookmark:

```bash
wrangler d1 time-travel info DB \
  --env staging \
  --config apps/edge-api/wrangler.jsonc \
  --json
```

O Wrangler atual também permite restaurar por bookmark:

```bash
wrangler d1 time-travel restore DB \
  --env staging \
  --config apps/edge-api/wrangler.jsonc \
  --bookmark <bookmark> \
  --json
```

### Regra importante

Time Travel restaura o **banco inteiro** para aquele ponto, não apenas rows da foundation.

Portanto restore não deve ser automático em ambiente com escritas concorrentes. Antes de uma aplicação real precisamos definir uma janela exclusiva/maintenance window para staging ou provar que não haverá escrita concorrente relevante.

O bookmark deve ser tratado como rollback point da execução e registrado no runbook/artefato operacional, não em código.

## Ainda fora de escopo

Esta PR deliberadamente não:

- ativa a flag;
- cria secret;
- altera `wrangler.jsonc`;
- faz deploy;
- chama staging;
- captura bookmark real;
- restaura banco;
- cria CLI de apply;
- executa reconciliação pós-write automaticamente;
- migra dados reais;
- toca produção/main.

## Próximo slice

Depois deste transport estar integrado e verde, a próxima etapa deve ser um **orquestrador local de staging**, ainda com execução real separada da implementação.

Ele deverá:

1. receber somente snapshot em `.migration/`;
2. gerar/verificar source manifest;
3. capturar Time Travel bookmark antes do POST;
4. exigir confirmação explícita do operador para o tenant/projection;
5. chamar somente a rota staging acima;
6. executar o extractor D1 após a escrita;
7. gerar destination manifest;
8. executar reconciliation;
9. encerrar com sucesso apenas em `in_sync=true`;
10. se houver divergência, bloquear avanço e apresentar o bookmark + comando de restore, sem executar restore automaticamente.

Somente depois do orquestrador e do runbook estarem verdes devemos configurar temporariamente a feature em staging para a primeira prova real.
