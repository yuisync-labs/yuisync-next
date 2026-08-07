# Fase 7 — Extractors read-only da foundation

## Objetivo

Conectar a projection `phase7-foundation/v1` às fontes reais sem introduzir escrita, dual-write ou cutover.

O pipeline desta etapa é:

```text
Supabase Data API (GET only)
  -> rows físicas
  -> projectSupabaseFoundation()
  -> snapshot local .migration/
  -> manifest

D1 staging (SELECT only via Wrangler)
  -> rows físicas
  -> projectD1Foundation()
  -> snapshot local .migration/
  -> manifest

source manifest + destination manifest
  -> reconcile
```

A regra de equivalência permanece na projection. Os extractors apenas carregam o mínimo necessário.

## Restrições fortes

Esta PR não contém:

- `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, DDL ou migrations novas;
- comando `apply`;
- endpoint HTTP novo;
- alteração de staging/produção;
- importação de dado real no CI;
- dual-read/dual-write de runtime;
- secrets em argumentos de CLI.

## Supabase extractor

Arquivo:

```text
scripts/migration/foundationExtractors.mjs
```

A origem usa diretamente o Data API do Supabase com requisições `GET`.

### Leituras fixas

Por `(tenant_id,module_id)`, o extractor lê:

1. `tenants`
   - `id,name,slug,active`;
   - filtro exato por tenant;
   - no máximo duas linhas para detectar violação inesperada.

2. `profile_tenants`
   - `profile_id,tenant_id,role,active`;
   - profile relacionado embutido com `id,full_name,email,role,active`;
   - filtro exato por tenant;
   - paginação read-only.

3. `profiles`
   - somente `role=admin`;
   - necessário para materializar a semântica legada de global admin mesmo sem `profile_tenants`;
   - paginação read-only.

4. `settings`
   - somente os campos da projection base;
   - filtro exato por tenant + module;
   - sem MotoDog, PIX, agenda, autonomia, equipe ou outros campos do God-row.

### Por que não usar o browser/client SDK

O extractor é tooling administrativo local e precisa enxergar:

- memberships do tenant;
- profiles necessários para a projection;
- global admins;
- settings mesmo sob RLS.

Por isso ele usa uma credencial server-side elevada, nunca uma chave pública do frontend.

## Supabase admin API keys

O tooling aceita duas gerações de credencial server-side:

### Preferida

```text
SUPABASE_SECRET_KEY=sb_secret_...
```

As novas secret keys são opacas, têm privilégios elevados e bypassam RLS. Elas são enviadas apenas no header `apikey` pelo extractor.

### Compatibilidade legada

```text
SUPABASE_SERVICE_ROLE_KEY=<legacy JWT>
```

A legacy service-role key é JWT-based. O extractor envia:

```text
apikey: <key>
Authorization: Bearer <key>
```

### Ordem

A CLI usa:

```text
SUPABASE_SECRET_KEY
  -> se ausente, SUPABASE_SERVICE_ROLE_KEY
```

Nenhuma chave administrativa pode ser passada como argumento da CLI. Isso reduz exposição em shell history e process list.

## Segurança do Supabase reader

- HTTPS obrigatório, exceto localhost para testes locais;
- método sempre `GET`;
- sem request body;
- `redirect: error`;
- erros não incluem URL completa, response body ou chave;
- respostas precisam ser arrays JSON;
- resultados paginados têm limite máximo defensivo;
- conflito entre o mesmo profile obtido pela relation e pela lista de admins falha fechado;
- projection valida ownership, status e referências depois da extração.

## D1 extractor

O D1 staging é lido por Wrangler, sem criar rota administrativa no Worker.

Comando base confirmado para a CLI atual:

```text
wrangler d1 execute DB --remote --env staging --command <SELECT> --json
```

O runner é executado via workspace `@yuisync/edge-api` e usa o `wrangler.jsonc` por caminho absoluto.

### Por que Wrangler

- reutiliza autenticação/configuração oficial Cloudflare;
- usa o binding `DB` já definido no ambiente staging;
- não exige endpoint temporário de exportação;
- não exige colocar token Cloudflare em argumentos próprios do YuiSync;
- permite saída JSON estruturada para tooling.

## Queries D1 fixas

`buildD1FoundationQueries()` gera exatamente quatro queries:

1. tenant;
2. memberships do tenant;
3. identity principals ligados às memberships;
4. base settings do tenant/module.

Características:

- todas começam com `SELECT`;
- nenhuma contém `;`;
- tenant/module são validados antes de interpolação;
- identificadores aceitos não permitem aspas ou fragmentos SQL;
- não existe opção para o operador fornecer SQL customizado.

O runner, além disso, recusa qualquer string que não comece em `SELECT` ou que contenha `;`.

## Ambiente D1 travado

Nesta etapa:

```text
environment = staging
binding = DB
```

são os únicos valores aceitos.

Não existe opção `--env production` na CLI do extractor.

Isso é deliberado: primeiro precisamos provar extração + manifest + reconciliação em staging antes de ampliar a ferramenta.

## Formato JSON do Wrangler

`parseWranglerD1Json()` aceita o envelope JSON retornado pelo Wrangler e extrai somente `results`.

Falha fechado quando:

- stdout não é JSON;
- envelope é inválido;
- `success=false`;
- `results` não é array.

Metadata do Wrangler não entra na projection.

## CLI

Arquivo:

```text
scripts/migration/foundation-extract-cli.mjs
```

### Origem Supabase

Exemplo com `.env` server-side:

```bash
node --env-file=.env scripts/migration/foundation-extract-cli.mjs supabase \
  --tenant <tenant-id> \
  --module petshop \
  --snapshot-id source-2026-08-07T170000Z \
  --output .migration/source.snapshot.json
```

### Destino D1 staging

Com Wrangler autenticado:

```bash
node scripts/migration/foundation-extract-cli.mjs d1-staging \
  --tenant <tenant-id> \
  --module petshop \
  --snapshot-id d1-staging-2026-08-07T170000Z \
  --output .migration/d1.snapshot.json
```

## Guardrails da CLI

Opções permitidas:

- `--tenant`;
- `--module`;
- `--snapshot-id`;
- `--output`.

Qualquer outra opção é recusada, inclusive tentativas de fornecer chave/token por argumento.

O output:

- precisa ser `.json`;
- precisa estar dentro de `.migration/`;
- é criado com `wx`, portanto não sobrescreve arquivo existente;
- solicita modo `0600` onde o sistema operacional suporta permissões POSIX;
- nunca é impresso no stdout.

A pasta `.migration/` já está ignorada pelo Git.

## Natureza dos snapshots

Diferentemente do manifest, o **snapshot bruto contém dados** necessários para gerar os hashes e pode incluir:

- nome/email de identities;
- telefone/endereço da unidade;
- bot prompt.

Portanto:

- snapshots são temporários;
- ficam apenas em `.migration/`;
- não devem ser anexados a PRs/issues;
- não devem ser enviados a logs;
- devem ser removidos ao finalizar a execução/runbook;
- manifests/reports são preferidos como evidência operacional porque não carregam payload bruto.

## Runbook de reconciliação desta foundation

Depois de gerar os dois snapshots:

```bash
node scripts/migration/manifest-cli.mjs build \
  --input .migration/source.snapshot.json \
  --output .migration/source.manifest.json

node scripts/migration/manifest-cli.mjs build \
  --input .migration/d1.snapshot.json \
  --output .migration/d1.manifest.json

node scripts/migration/manifest-cli.mjs reconcile \
  --source .migration/source.manifest.json \
  --destination .migration/d1.manifest.json \
  --output .migration/reconciliation.json
```

Exit codes do reconciliador continuam:

- `0`: em sync;
- `2`: divergência de dados;
- `1`: ferramenta/input inválido.

## O que este slice ainda não prova

Ele prova que conseguimos **ler** os dois lados pelo mesmo contrato.

Ainda não prova:

- que temos dados migrados no D1 staging;
- que o writer será idempotente;
- rollback de importação;
- roles/permissões administrativas;
- clients/pets;
- cutover.

É esperado que o D1 staging inicialmente produza `missing` até existir um writer controlado para materializar a foundation.

## Testes

A suíte cobre:

- Supabase somente `GET`;
- tenant/module sempre filtrados;
- legacy service-role JWT em `apikey` + Bearer;
- nova `sb_secret_` apenas em `apikey`;
- segredo ausente de snapshots/erros;
- quatro SELECTs D1 fixos;
- rejeição de tentativa de SQL injection no tenant;
- parser JSON do Wrangler;
- runner travado em staging/DB;
- rejeição de non-SELECT;
- reconciliação ponta-a-ponta com source/destination fakes;
- CLI recusando output fora de `.migration`;
- CLI recusando credenciais em argumentos;
- ausência de qualquer modo apply.

## Próximo slice

Se esta PR ficar verde, a próxima etapa não deve pular direto para clients/pets.

Primeiro precisamos criar o **writer idempotente da foundation para D1 staging**, em PR separada, com:

1. plano/manifest de entrada;
2. confirmação explícita de staging;
3. IDs determinísticos;
4. transação/batch quando aplicável;
5. nenhuma exclusão destrutiva;
6. execução repetível;
7. snapshot/manifest antes e depois;
8. reconciliação obrigatória após apply;
9. runbook de rollback.

Somente depois desse writer ser provado em staging devemos aplicar o mesmo padrão a `clients/pets`.
