# Fase 7 — Foundation de importação e reconciliação

## Objetivo

Criar uma camada determinística e offline para provar que um snapshot de origem e um snapshot de destino representam os mesmos registros antes de qualquer cutover de dados.

Este slice **não lê Supabase, não escreve D1 e não possui modo `apply`**.

```text
origem extraída
  -> snapshot local bruto
  -> canonicalização
  -> manifest sem payload bruto
  -> SHA-256 por registro
  -> SHA-256 por coleção
  -> SHA-256 do manifest

D1 extraído
  -> snapshot local bruto
  -> mesmo pipeline
  -> manifest

source manifest + destination manifest
  -> valida scope + projection version
  -> reconciliation report
  -> in_sync | missing | extra | mismatched
```

## Por que não reutilizar diretamente `import_legacy_petshop.py`

O script legado continua útil para manutenção histórica das planilhas `Produtos.xls` e `Pessoas.xls`, especialmente por sua lógica de parsing e normalização.

Porém o fluxo de execução atual foi desenhado para atualizar o Supabase existente:

- exige `SUPABASE_SERVICE_ROLE_KEY`;
- resolve tenant diretamente no REST do Supabase;
- no import completo, faz soft-delete dos clients/products ativos do tenant;
- reativa/upserta produtos e insere clientes diretamente;
- cria backup JSON local antes da alteração;
- não produz checksum canônico origem/destino;
- não faz reconciliação automática após a escrita.

O YuiSync Next não deve herdar esse mecanismo como estratégia de migração. A transformação/parsing poderá ser reaproveitada posteriormente atrás do novo pipeline.

## Snapshot bruto

O input da foundation é JSON local com este formato:

```json
{
  "projection": {
    "name": "phase7-foundation",
    "version": 1
  },
  "source": {
    "system": "supabase",
    "snapshot_id": "export-2026-08-07T160000Z"
  },
  "scope": {
    "tenant_id": "tenant-interno",
    "module_id": "petshop"
  },
  "collections": {
    "tenant_module_settings": [
      {
        "key": "tenant-interno:petshop",
        "data": {
          "tenant_id": "tenant-interno",
          "module_id": "petshop",
          "store_name": "..."
        }
      }
    ]
  }
}
```

### Regras do snapshot

- `projection.name` e `projection.version` são obrigatórios;
- `tenant_id` e `module_id` são obrigatórios;
- cada coleção possui registros `{ key, data }`;
- `key` deve ser uma chave lógica estável e não sensível;
- **não usar telefone, CPF/CNPJ, email, token ou segredo como `key`**;
- `data` precisa ser JSON determinístico: sem `undefined`, `NaN`, `Infinity`, funções, BigInt ou objetos de runtime como `Date`;
- campos com nomes que sugerem segredo são rejeitados antes do hash;
- snapshots brutos devem ficar em `.migration/`, que está no `.gitignore`.

O hash da chave protege o identificador de exposição casual, mas SHA-256 **não é criptografia de dados pessoais de baixa entropia**. Portanto a regra continua sendo não usar PII como chave lógica.

## Projection contract

`schema_version` do manifest diz como o arquivo de manifest é estruturado. Ele **não** diz quais campos de negócio foram extraídos.

Por isso cada snapshot carrega também:

```json
{
  "projection": {
    "name": "phase7-foundation",
    "version": 1
  }
}
```

Uma projection define o shape normalizado que origem e destino precisam produzir. Por exemplo:

```text
phase7-foundation/v1
  -> tenants
  -> identity_principals
  -> tenant_memberships
  -> tenant_module_settings
```

Se um extractor adicionar/remover/alterar semanticamente campos, a versão da projection deve mudar.

A reconciliação recusa source/destination com projection diferente usando `PROJECTION_MISMATCH`. Isso evita comparar, por exemplo, uma exportação v1 com um extractor D1 v2 e interpretar diferenças de contrato como corrupção de dados.

## Manifest

Comando:

```bash
node scripts/migration/manifest-cli.mjs build \
  --input .migration/source.snapshot.json \
  --output .migration/source.manifest.json
```

O manifest contém somente:

- versão do schema de manifest;
- nome/versão da projection;
- identificação não sensível da fonte/snapshot;
- scope tenant/module;
- nome das coleções;
- contagem de linhas;
- `key_hash` SHA-256;
- checksum SHA-256 do payload canônico de cada registro;
- checksum agregado da coleção;
- checksum do manifest.

Ele **não contém `record.data` nem a chave lógica em texto**.

## Canonicalização

`canonicalJson()` ordena deterministicamente chaves de objetos antes de serializar.

Assim, estes objetos possuem o mesmo checksum:

```json
{"id":"1","name":"A"}
```

```json
{"name":"A","id":"1"}
```

A ordem dos registros dentro de uma coleção também não altera o manifest: os registros são ordenados por `key_hash`.

Arrays permanecem ordenados semanticamente conforme o input. Se a ordem de um array não fizer parte do domínio, o extractor daquele domínio deve normalizá-la antes de construir o snapshot.

Somente valores representáveis como JSON puro são aceitos. Isso evita que objetos de runtime tenham serialização implícita diferente entre ferramentas.

## Proteção contra segredos

A foundation rejeita nomes de campos semelhantes a:

- `password`;
- `secret`;
- `service_role` / `service_role_key`;
- `access_token`;
- `refresh_token`;
- `authorization`;
- `api_key` / `apikey`;
- `private_key`.

Isso não substitui classificação de dados. É um guardrail adicional para evitar que credenciais entrem acidentalmente no pipeline de migração.

## Reconciliação

Comando:

```bash
node scripts/migration/manifest-cli.mjs reconcile \
  --source .migration/source.manifest.json \
  --destination .migration/destination.manifest.json \
  --output .migration/reconciliation.json
```

Antes de comparar registros, o reconciliador exige:

1. schema de manifest suportado;
2. checksum global válido;
3. checksums das coleções válidos;
4. `row_count` coerente com os registros do manifest;
5. hashes de registro válidos/únicos;
6. mesmo `tenant_id` + `module_id`;
7. mesma projection + version.

Resultado por coleção:

- `source_row_count`;
- `destination_row_count`;
- `missing`: existe na origem, não no destino;
- `extra`: existe no destino, não na origem;
- `mismatched`: mesma chave lógica, conteúdo diferente;
- `in_sync`.

Os arrays `missing/extra/mismatched` carregam apenas `key_hash`, nunca a chave em texto.

### Exit codes

- `0`: manifests reconciliados e `in_sync=true`;
- `2`: reconciliação executada corretamente, mas há divergência;
- `1`: input/configuração/manifest inválido ou falha da ferramenta.

Isso permite usar o reconciliador como gate em CI ou runbook sem confundir “dados divergentes” com “ferramenta quebrada”.

## Integridade do manifest

Antes de reconciliar, o checksum global e o checksum de cada coleção são recalculados.

Alterar manualmente projection, contagem, checksum de registro, coleção, scope ou metadata torna o manifest inválido.

O manifest não é uma assinatura criptográfica e não prova quem o produziu. Ele prova consistência do conteúdo contra alterações acidentais e fornece um identificador determinístico para a execução. Assinatura/atestado pode ser adicionada mais tarde se houver requisito operacional.

## Scope e isolamento

A reconciliação recusa manifests com `tenant_id` ou `module_id` diferentes.

Isso impede comparar acidentalmente:

```text
tenant A / petshop
```

contra:

```text
tenant B / petshop
```

ou módulos diferentes.

Essa proteção é adicional; extractors e writers futuros continuam obrigados a aplicar tenant isolation no acesso aos bancos.

## O que esta PR deliberadamente não faz

- não conecta ao Supabase;
- não usa service role;
- não conecta ao D1;
- não executa `wrangler d1 execute`;
- não cria migration SQL;
- não importa tenants reais;
- não importa identities/memberships reais;
- não importa settings reais;
- não importa clients/pets;
- não altera `import_legacy_petshop.py`;
- não cria dual-write;
- não altera staging/produção;
- não altera `main`.

## Testes

A foundation cobre:

- canonicalização independente da ordem das chaves;
- manifest independente da ordem dos registros;
- ausência de payload e chave lógica no manifest;
- bloqueio de campos secret-like;
- bloqueio de chave lógica duplicada;
- reconciliação idêntica;
- classificação separada de missing/extra/mismatched;
- bloqueio de scope divergente;
- bloqueio de projection/version divergente;
- detecção de manifest alterado;
- validação interna de collections/records;
- rejeição de valores e objetos não JSON;
- CLI offline;
- exit code `0` para sync e `2` para divergência.

## Próximo slice

Com esta foundation integrada, o próximo passo deve ser **extração tipada, ainda read-only**, começando pelas estruturas já criadas no D1:

1. `tenants`;
2. `identity_principals`;
3. `tenant_memberships`;
4. `tenant_module_settings`.

Os extractors de origem e destino devem implementar a mesma projection versionada e alimentar exatamente o mesmo manifest/reconciliador.

Somente depois de provar extração + reconciliação com fixtures e ambiente de teste deve surgir uma ferramenta de `apply`, em PR separada, com confirmação explícita, idempotência e rollback documentado.
