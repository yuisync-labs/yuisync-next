# Fase 7 — Orquestrador local da foundation em staging

## Objetivo

Encadear, em uma única operação auditável, as peças já construídas para a migration `phase7-foundation/v1`:

```text
source snapshot local
  -> source manifest
  -> Time Travel bookmark pré-write
  -> POST staging protegido
  -> D1 writer atômico
  -> D1 extractor read-only
  -> destination manifest
  -> reconciliation
  -> in_sync | diverged
```

Este slice cria o **orquestrador e o runbook**, mas ainda não ativa a feature no Worker staging e não executa migração real.

## Arquivos

Core:

```text
scripts/migration/foundationStagingOrchestrator.mjs
```

CLI:

```text
scripts/migration/foundation-staging-orchestrator-cli.mjs
```

A CLI não contém modo production e não aceita target/binding/token/URL por argumentos.

## Pré-condições operacionais

Antes de uma execução real futura:

1. a versão do Worker contendo o transport precisa estar deployada em staging;
2. `EDGE_DATABASE_ENABLED=true` precisa estar configurado no Worker staging;
3. `EDGE_FOUNDATION_MIGRATION_ENABLED=true` precisa ser ativado temporariamente;
4. `FOUNDATION_MIGRATION_TOKEN` precisa existir como secret do Worker staging;
5. o operador local precisa possuir o mesmo token via env server-side;
6. `YUISYNC_STAGING_EDGE_URL` precisa apontar para o Worker staging via HTTPS;
7. Wrangler precisa estar autenticado na conta Cloudflare correta;
8. o D1 staging precisa estar em uma janela operacional sem writes concorrentes relevantes;
9. o source snapshot precisa ter sido extraído pelo extractor Supabase e estar em `.migration/`.

Nenhuma dessas ativações é feita por esta PR.

## Comando

Exemplo futuro:

```bash
node --env-file=.env.staging-migration \
  scripts/migration/foundation-staging-orchestrator-cli.mjs \
  --snapshot .migration/source.snapshot.json \
  --confirm-tenant <tenant-id> \
  --confirm-projection phase7-foundation/v1
```

Variáveis locais:

```text
YUISYNC_STAGING_EDGE_URL=https://<staging-worker-host>
FOUNDATION_MIGRATION_TOKEN=<secret>
```

### O que deliberadamente não existe

```text
--env
--binding
--staging-url
--token
--api-key
--restore
--production
```

URL e token não entram em shell history/process list como argumentos da ferramenta.

O ambiente/binding Cloudflare usados por Time Travel e pelo extractor continuam fixos em:

```text
staging / DB
```

## Snapshot permitido

A CLI resolve o caminho físico com `realpath()` e só aceita arquivo `.json` cujo path real permaneça dentro de `.migration/`.

Isso bloqueia inclusive um symlink dentro de `.migration/` apontando para fora.

O core exige adicionalmente:

```text
source.system = supabase
projection = phase7-foundation/v1
```

E valida o manifest antes de capturar o bookmark.

## Confirmação explícita

O operador precisa repetir:

```text
--confirm-tenant <tenant-id>
--confirm-projection phase7-foundation/v1
```

Os valores precisam corresponder exatamente ao source manifest.

Uma confirmação errada aborta **antes** de:

- Time Travel bookmark;
- POST;
- qualquer write.

Isso evita que um arquivo correto para tenant A seja aplicado porque o operador acreditava estar operando tenant B.

## Artifact writer obrigatório

O core não permite execução programática sem `writeArtifact`.

Na CLI, cada execução ganha:

```text
.migration/runs/<run-id>/
```

Arquivos podem incluir:

```text
source.manifest.json
plan.json
transport.json
destination.snapshot.json
destination.manifest.json
reconciliation.json
result.json
failure.json
```

A pasta `.migration/` continua ignorada pelo Git.

### Dados sensíveis

`destination.snapshot.json` é snapshot bruto e pode conter PII/configuração tenant-scoped.

Ele:

- fica somente em `.migration/`;
- é criado com modo `0600` quando suportado;
- não deve ser anexado a PR/issue/log;
- deve ser removido de acordo com a política operacional após a validação.

Manifests/reconciliation permanecem a evidência preferida por não carregarem payload bruto.

## Run ID / correlation

Cada execução gera um `run_id` compatível com `x-request-id`.

O mesmo ID é usado no POST para correlacionar:

- artefatos locais;
- logs do Worker;
- resposta do transport.

O orquestrador exige que a resposta HTTP 200 devolva o mesmo `request_id`. Caso contrário, trata como protocol error.

## Checksum dos bytes exatos

Antes de qualquer write:

```text
SHA-256(source snapshot bytes)
```

é calculado localmente.

O mesmo array de bytes:

- gera o digest local;
- é enviado no body do POST.

O digest vai no header:

```text
x-yuisync-migration-snapshot-sha256
```

O Worker recalcula e valida antes do writer.

Assim, o plano/artefato local e o payload enviado ficam ligados ao mesmo arquivo físico.

## Time Travel pré-write

O orquestrador chama somente:

```text
wrangler d1 time-travel info DB --env staging --json
```

através do workspace do edge-api e com o `wrangler.jsonc` absoluto.

O bookmark precisa ser obtido **antes** do POST. Se a captura falha, o POST não acontece.

O bookmark é registrado em `plan.json`.

## Time Travel restore nunca é automático

O core não possui dependency/callback de restore.

Ele apenas gera um comando textual com:

```text
time-travel restore DB
--env staging
--bookmark <prewrite bookmark>
```

### Motivo

D1 Time Travel restaura o banco inteiro para aquele estado.

Se outro write legítimo acontecer depois do bookmark, restore também o desfaria.

Portanto:

```text
orquestrador detecta problema
  -> para
  -> registra bookmark + comando
  -> operador avalia exclusividade/janela
  -> restore é decisão separada
```

Nunca:

```text
reconciliation failed
  -> auto restore
```

## Fluxo de execução

### 1. Source manifest

O snapshot é transformado em manifest usando o tooling já integrado.

A execução para se:

- source não é Supabase;
- projection não é `phase7-foundation/v1`;
- manifest é inválido;
- tenant/projection confirmados não correspondem.

### 2. Bookmark

Só após todas as validações pré-write.

### 3. Plan artifact

`plan.json` registra:

- run ID;
- staging;
- source snapshot label;
- SHA-256 dos bytes;
- checksum do source manifest;
- projection;
- scope;
- bookmark;
- URL alvo sem secret.

### 4. POST

O poster envia somente para:

```text
/internal/migration/foundation
```

com:

- migration token via header;
- request/run ID;
- SHA-256;
- bytes exatos do snapshot.

Redirect HTTP é recusado.

### 5. Destination extraction

Após HTTP 200, o orquestrador executa o extractor D1 staging já integrado.

Nenhum endpoint de exportação é criado.

### 6. Destination manifest

Usa o mesmo projection contract/version.

### 7. Reconciliation

Somente existem dois resultados operacionais válidos:

#### `in_sync`

Exit code:

```text
0
```

A source projection e o destination D1 reconciliaram integralmente.

#### `diverged`

Exit code:

```text
2
```

O orquestrador:

- não continua para próximo tenant/domínio;
- não executa restore;
- grava reconciliation/result;
- imprime bookmark + comando de restore como evidência de recovery.

## Falha depois do bookmark

Exemplos:

- timeout/erro de rede durante POST;
- transport protocol inválido;
- extractor D1 falha após HTTP 200;
- manifest destination inválido;
- filesystem falha ao gravar um artefato posterior.

O erro propagado preserva o `rollbackBookmark`.

O tooling tenta gravar `failure.json`, mas uma falha local ao escrever esse arquivo **não pode mascarar** o erro original nem remover o bookmark da exceção/console.

## Falha ambígua de rede

Se a conexão cair durante o POST, não é seguro presumir:

```text
"não escreveu"
```

O caller recebe:

```text
STAGING_TRANSPORT_UNAVAILABLE
prewrite_bookmark=<...>
restore_not_executed=true
```

O operador deve inspecionar/reextrair/reconciliar antes de decidir rollback.

## Staging URL

`YUISYNC_STAGING_EDGE_URL`:

- precisa ser HTTPS;
- não aceita username/password embutidos;
- não aceita query/hash;
- o path fornecido é descartado e a rota interna fixa é usada.

O orquestrador não possui parâmetro production.

Além disso, o próprio Worker transport retorna 404 se `APP_ENV != staging`.

São duas boundaries independentes:

```text
local tooling -> staging-only configuration
Worker -> staging-only runtime guard
```

## Migration token

O token local:

- vem somente de environment;
- precisa ter comprimento/format coerente com o Worker;
- nunca é gravado em artefato;
- nunca é incluído em erro;
- nunca é mostrado no stdout/stderr;
- nunca é aceito como argumento da CLI.

## Testes

A suíte cobre:

- lifecycle completo bookmark -> POST -> extract -> reconcile;
- ordem das etapas;
- SHA-256 calculado dos bytes exatos;
- `in_sync` -> exit 0;
- divergence -> exit 2;
- ausência de auto-restore;
- confirmação de tenant errada abortando antes do bookmark;
- falha ambígua de transporte preservando bookmark;
- falha de `failure.json` não mascarando recovery;
- artifact writer obrigatório;
- source path label restrito a `.migration/`;
- parser de bookmark direto/envelopado;
- bookmark com shell metachar rejeitado;
- Wrangler Time Travel capture fixo em staging/DB e somente `info`;
- restore gerado somente como texto;
- poster com rota fixa, bytes exatos, checksum, token e request ID;
- erros HTTP sanitizados;
- URL não HTTPS rejeitada;
- CLI recusando `--token`, `--staging-url`, `--env production` e `--binding`;
- CLI recusando snapshot físico fora de `.migration/`.

## Ainda fora de escopo

Esta PR não:

- deploya Worker;
- ativa `EDGE_FOUNDATION_MIGRATION_ENABLED`;
- cria/atualiza secret Cloudflare;
- executa o orquestrador real;
- toca dados reais;
- executa Time Travel restore;
- toca produção/main;
- começa clients/pets.

## Gate para a primeira prova real

Depois desta PR integrada e verde, a **primeira prova real em staging** deve ser uma operação explícita, não outro atalho de código.

Checklist mínimo:

1. validar deploy staging atual;
2. aplicar migrations D1 staging se ainda não aplicadas;
3. verificar `/ready` antes da ativação;
4. configurar secret temporário de migração;
5. ativar `EDGE_DATABASE_ENABLED=true` e `EDGE_FOUNDATION_MIGRATION_ENABLED=true` apenas em staging;
6. verificar `/ready` = `configured`;
7. extrair um tenant de teste do Supabase;
8. executar orquestrador;
9. exigir `in_sync=true`;
10. executar novamente para provar idempotência real;
11. desativar `EDGE_FOUNDATION_MIGRATION_ENABLED` após o teste;
12. revalidar `/ready` e logs;
13. só então desenhar o mesmo pipeline para `clients/pets`.
