# Fase 7 — Projection semântica da foundation

## Objetivo

Definir um contrato semântico único para comparar a foundation existente no Supabase com a foundation equivalente no D1.

O problema é que os schemas físicos não são iguais e **não devem** ser iguais:

```text
Supabase/Postgres                 D1
-----------------                 --
tenants.active            <->      tenants.status
profiles.id               <->      identity_principals.subject
profile_tenants.profile_id         tenant_memberships.principal_id
settings + God-row         <->      tenant_module_settings base
Postgres timestamps                D1 timestamps/version
```

Comparar linhas físicas diretamente produziria falsos divergentes e empurraria detalhes legados para o schema novo.

A projection `phase7-foundation/v1` transforma ambos os lados no mesmo shape lógico antes do manifest/checksum.

## Característica do slice

Esta PR é **pure transformation only**:

- não conecta ao Supabase;
- não conecta ao D1;
- não usa secrets;
- não executa queries;
- não grava dados;
- não altera migrations;
- não altera runtime.

Ela recebe rows já extraídas e devolve o snapshot esperado por `manifest.mjs`.

## Projection contract

```json
{
  "name": "phase7-foundation",
  "version": 1
}
```

Coleções:

1. `tenants`;
2. `identity_principals`;
3. `tenant_memberships`;
4. `tenant_module_settings`.

Uma alteração semântica neste contrato exige nova versão da projection.

## Tenant

### Regra de identidade

O `tenant.id` atual do legado será preservado no D1.

Motivo:

- dados operacionais existentes já usam esse ID como FK/tenant boundary;
- gerar um ID novo exigiria mapa de tradução em todos os domínios seguintes;
- o ID atual já é uma identidade estável do tenant, não um detalhe de armazenamento que precisamos esconder.

Projection:

```json
{
  "id": "tenant-id",
  "slug": "slug-normalizado",
  "name": "Nome",
  "status": "active"
}
```

O boolean `tenants.active` do legado é convertido para `active | inactive` do D1.

Timestamps não participam da reconciliação semântica.

## Identidade

### Legado

No backend atual, o profile é carregado por:

```text
profiles.id = Supabase Auth user.id
```

Portanto `profiles.id` já funciona como `subject` do provedor de identidade.

### D1

O D1 separa:

```text
identity_principals.id       -> ID interno do YuiSync
provider                     -> supabase
subject                      -> Supabase Auth user.id
```

O ID interno do principal **não é comparado**.

Projection:

```json
{
  "provider": "supabase",
  "subject": "auth-user-id",
  "display_name": "Nome",
  "email": "email-normalizado",
  "status": "active"
}
```

A chave lógica é:

```text
identity:<provider>:<subject>
```

Essa escolha permite trocar a estratégia de IDs internos ou o adapter de autenticação sem reescrever o domínio.

## Membership

Projection:

```json
{
  "tenant_id": "tenant-id",
  "provider": "supabase",
  "subject": "auth-user-id",
  "status": "active"
}
```

A chave lógica é:

```text
membership:<tenant>:<provider>:<subject>
```

Novamente, `principal_id` físico do D1 não entra na comparação.

## Paridade de global admin

O legado possui uma exceção importante:

```text
profile.role === 'admin'
```

é tratado como acesso global em várias boundaries de autorização. Isso não depende de `profile_tenants` para conceder acesso ao tenant.

O novo `TenantAuthorizationPort`, porém, foi intencionalmente desenhado sem bypass mágico: ele exige membership persistida.

### Decisão de migração

Durante a projection/importação, um profile global admin será materializado como membership explícita em cada tenant migrado.

```text
admin global ativo
  -> membership ativa projetada para o tenant
```

Mesmo que exista um `profile_tenants.active=false`, um profile global admin ainda é projetado como ativo enquanto o próprio profile estiver ativo, porque essa é a semântica do sistema legado.

Um admin global com `profile.active=false` é projetado como membership inativa.

Isso permite remover a exceção implícita do legado sem remover o acesso que ela representava.

### Importante

Esta projection preserva **tenant inclusion**, não roles/permissões por módulo.

`role`, `allowed_modules`, `module_permissions`, `staff_type` e permissões administrativas não são migrados por esta PR. Uma camada de autorização de roles/entitlements será tratada separadamente antes de cortar endpoints administrativos.

## Perfis normais

Profiles não-admin só entram na projection de um tenant quando existe `profile_tenants` para aquele tenant.

Um profile de outro tenant:

- não entra em `identity_principals` daquele snapshot;
- não entra em `tenant_memberships`;
- não aumenta exposição de PII na extração daquele scope.

Membership normal explícita inativa continua inativa.

Profile inativo também resulta em membership inativa.

## Base settings

A projection compara apenas os campos introduzidos em `tenant_module_settings`:

- `store_name`;
- `store_phone`;
- `store_address`;
- `store_neighborhood`;
- `store_city`;
- `bot_prompt`.

Não participam:

- `version` D1;
- timestamps;
- MotoDog;
- PIX;
- autonomia do PetBot;
- horários/capacidade de agenda;
- equipe;
- templates;
- lembretes;
- fidelidade;
- qualquer outro campo do God-row legado.

Assim, diferenças em campos que ainda não pertencem ao slice não bloqueiam a migração da foundation e também não são silenciosamente copiadas para o D1.

## Ausência de settings

Se nenhum lado possui `tenant_module_settings` para o scope, a coleção vazia é válida e reconcilia.

Se apenas um lado possui a linha, o manifest acusa `missing` ou `extra`.

Mais de uma linha para o mesmo `(tenant,module)` é erro de integridade e a projection falha fechado.

## Fail closed

A projection recusa, entre outros:

- tenant solicitado diferente do row recebido;
- `profile_tenants` sem `profile_id`;
- membership que referencia profile ausente;
- membership D1 que referencia principal ausente;
- settings duplicados para o scope;
- módulo/tenant inválido;
- chave lógica duplicada após projection.

Não existe fallback para outro tenant nem tentativa de “consertar” ownership automaticamente.

## Testes

Os testes demonstram:

- schemas físicos diferentes reconciliam quando a semântica é igual;
- tenant ID legado é preservado;
- `principal_id` interno do D1 não influencia checksum;
- email é normalizado;
- profile fora do tenant é excluído;
- admin global ativo ganha membership projetada mesmo sem link;
- admin global ativo continua ativo mesmo com link explicitamente inativo, preservando a semântica atual;
- admin global inativo fica inativo;
- membership normal inativa fica inativa;
- God-row extras e metadata física de settings são ignorados;
- ausência simétrica de settings reconcilia;
- referências órfãs e duplicidade falham fechado.

## Próximo slice

Depois desta projection estar verde e integrada, os extractors read-only poderão ser pequenos e objetivos:

```text
Supabase extractor
  -> carrega somente rows necessárias
  -> projectSupabaseFoundation()
  -> manifest

D1 extractor
  -> carrega somente rows necessárias
  -> projectD1Foundation()
  -> manifest

manifests
  -> reconcile
```

O extractor não deve conter regra de equivalência. Essa lógica pertence exclusivamente à projection versionada.

Somente depois de provar a extração real em ambiente controlado será desenhado o writer/apply, em PR separada.
