# Fase 7 — Writer atômico da foundation no D1

## Objetivo

Criar o primeiro writer de migração para a projection `phase7-foundation/v1`, com semântica conservadora e idempotente, **sem expor ainda uma rota ou CLI capaz de executá-lo contra staging**.

O writer recebe exclusivamente o snapshot semântico produzido pelo extractor Supabase:

```text
Supabase GET-only
  -> projectSupabaseFoundation()
  -> phase7-foundation/v1 snapshot
  -> D1FoundationWriter
  -> D1Database.batch(...)
```

## Por que o writer vive no runtime Worker

A API atual do Cloudflare D1 documenta `D1Database.batch()` como uma transação: statements são executados sequencialmente e, se um deles falhar, a sequência inteira é abortada/rollbackada.

Isso é a garantia necessária para escrever em conjunto:

- tenant;
- identity principals;
- memberships;
- base settings.

O tooling REST/Wrangler continua sendo usado para extração/administração, mas não é usado neste slice como base para afirmar atomicidade de múltiplas decisões condicionais.

## Escopo deste PR

Implementação:

```text
apps/edge-api/src/migration/d1FoundationWriter.ts
```

Testes reais em workerd/D1:

```text
apps/edge-api/test/d1FoundationWriter.test.ts
```

Não existe nesta PR:

- rota HTTP;
- feature flag nova;
- secret novo;
- CLI de apply;
- alteração de `wrangler.jsonc`;
- escrita real em staging;
- alteração de schema;
- alteração de `main` ou produção.

Portanto o writer é compilável/testável, mas operacionalmente inalcançável fora dos testes.

## Input aceito

O writer aceita somente:

```text
projection.name    = phase7-foundation
projection.version = 1
source.system      = supabase
```

E exatamente as quatro collections:

1. `tenants`;
2. `identity_principals`;
3. `tenant_memberships`;
4. `tenant_module_settings`.

O snapshot é revalidado no runtime Worker; o writer não confia apenas no fato de outro script ter produzido o arquivo.

### Validações

Entre outras:

- uma única row de tenant;
- no máximo uma row de base settings;
- tenant/module iguais ao scope;
- keys lógicas coerentes com os dados;
- provider/module normalizados para lowercase;
- status somente `active|inactive`;
- limites de comprimento compatíveis com o schema D1;
- identidade única por `provider + subject`;
- membership única por identidade;
- toda identity projetada possui exatamente uma membership e vice-versa;
- email, quando presente, já normalizado para lowercase;
- source diferente de Supabase é rejeitada.

Isso reduz a chance de um snapshot manual ou de outra projection ser usado por engano.

## IDs internos de identities

A projection deliberadamente não exige que o ID físico do D1 seja o mesmo UUID do Supabase Auth.

Para identities novas, o writer produz deterministicamente:

```text
principal_<sha256(provider + NUL + subject)>
```

Isso dá um ID:

- estável entre execuções;
- independente de timestamps;
- sem expor o subject diretamente no ID interno;
- curto o suficiente para as constraints atuais.

### Identity já existente

Se `provider + subject` já existir no D1 com os mesmos dados semânticos, o writer **reutiliza o principal existente mesmo que seu `id` físico seja diferente**.

Memberships são inseridas buscando `principal.id` por `provider + subject`, não assumindo o ID determinístico.

Isso preserva a decisão da projection de que `principal_id` é detalhe físico do destino.

## Regra de escrita

O writer não faz update destrutivo/convergente automático.

Para cada objeto, existem somente três possibilidades:

### 1. Ausente

É inserido.

### 2. Já existe e é semanticamente idêntico

É mantido sem alteração.

A reexecução é no-op e não muda:

- timestamps;
- `tenant_module_settings.version`;
- IDs físicos existentes.

### 3. Já existe e diverge

A execução falha e o batch inteiro é revertido.

O writer **não decide qual lado deve vencer**. A divergência precisa ser investigada via extractor + manifest + reconciliation.

## Guard statements

Antes dos inserts, o writer usa statements condicionais que só tentam inserir uma row propositalmente inválida quando detectam conflito.

Exemplo conceitual:

```text
se tenant(id/slug) existente diverge do snapshot
  -> provocar constraint violation
  -> D1 batch lança erro
  -> rollback da sequência inteira
```

Os valores inválidos são escolhidos para violar constraints já existentes (`status`, IDs vazios, version inválida/FKs).

Isso permite manter:

```text
existing exact -> no-op
existing mismatch -> erro transacional
missing -> insert
```

sem introduzir tabela auxiliar ou trigger de migração.

## Proteções contra conflitos

### Tenant

O guard considera:

- mesmo `id`;
- colisão de `slug`;
- name/status divergentes.

### Identity

O guard considera simultaneamente:

- colisão do ID determinístico;
- `provider + subject` já existente;
- display name, email ou status divergente.

Um principal semanticamente idêntico com outro ID físico é permitido.

### Membership

O guard resolve a identity por `provider + subject` e recusa status divergente.

Além disso, antes da migração existe um guard de **membership extra**:

```text
membership existente no tenant
que não existe na source projection
  -> conflito
```

O writer nunca apaga membership extra para “fazer bater”.

### Settings

Se a source contém settings:

- row ausente -> insert;
- base fields idênticos -> no-op;
- base fields divergentes -> rollback.

`version` e timestamps físicos não participam da equivalência.

Se a source não possui settings e o destino possui, isso também é conflito. O writer não apaga a row extra.

## Atomicidade

Todos os guards/inserts são preparados com `.bind()` e enviados em um único:

```text
database.batch(statements)
```

O D1 documenta batches como transações. Se um guard provocar falha de constraint, inserts executados anteriormente no mesmo batch são rollbackados.

O teste de integração demonstra especificamente:

1. tenant/identity inicial já existem;
2. segunda execução tenta adicionar nova identity + membership;
3. somente depois encontra settings divergentes;
4. o batch falha;
5. a nova identity/membership não permanece no D1.

## Limite do primeiro writer

Este writer prioriza atomicidade sobre volume.

O D1 possui limites de queries por invocação; portanto este slice limita a operação a no máximo:

```text
48 prepared statements
```

Com a estrutura atual, uma foundation típica com settings suporta até cerca de 10 identities/memberships em um único batch.

Se o snapshot exceder isso:

```text
SNAPSHOT_TOO_LARGE
```

é retornado **antes de `database.batch()`**.

Não fazemos chunking automático porque dividir a foundation em múltiplos batches removeria a propriedade de rollback integral que este primeiro writer quer garantir.

Tenants maiores exigirão uma estratégia explicitamente desenhada, não um fallback silencioso.

## Erros

### `DATABASE_NOT_CONFIGURED`

Binding D1 ausente.

### `INVALID_SNAPSHOT`

Projection/source/scope/shape/invariantes inválidos.

### `SNAPSHOT_TOO_LARGE`

Não cabe no limite conservador de um único batch atômico desta versão.

### `FOUNDATION_WRITE_REJECTED`

O batch foi rejeitado por conflito/constraint/falha de escrita.

A mensagem é propositalmente genérica e não inclui PII nem SQL/valores. O runbook futuro deve reextrair o destino e reconciliar para identificar a classe da divergência.

## Idempotência

A suíte prova que executar o mesmo snapshot novamente:

- mantém uma única row de tenant;
- mantém uma única identity/membership;
- mantém uma única row de settings;
- não incrementa `settings.version`;
- não altera `created_at_ms`/`updated_at_ms`.

## Testes

Cobertura em D1/workerd:

- primeira aplicação;
- ID interno determinístico para identity nova;
- rerun idempotente;
- reutilização de principal semanticamente igual com ID físico diferente;
- rollback de inserts anteriores quando settings divergem;
- recusa de membership extra sem deletar;
- recusa de settings extra sem deletar;
- recusa de source/projection errada;
- recusa de snapshot acima do limite atômico;
- ausência de binding D1.

## Próximo slice

Depois deste writer estar verde e integrado, ainda **não** devemos escrever staging imediatamente por uma chamada improvisada.

A próxima etapa deve criar um transport operacional estreito e reversível que:

1. exista somente para staging;
2. exija autorização explícita de migração;
3. receba um snapshot/plan previamente gerado;
4. invoque este writer sem aceitar SQL;
5. produza correlation/run ID;
6. execute extractor D1 após a escrita;
7. gere manifest pós-write;
8. exija reconciliation `in_sync=true`;
9. documente Time Travel/bookmark/rollback antes da primeira execução real.

Somente então a foundation real será aplicada em staging.
