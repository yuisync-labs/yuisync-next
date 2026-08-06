# ADR-0002 — Cloudflare D1 como banco principal da nova arquitetura

- Status: accepted
- Data: 2026-08-06
- Decisores: YuiSync

## Contexto

O YuiSync está construindo uma nova arquitetura experimental em Cloudflare Workers. O objetivo desta fase não é transportar o banco legado imediatamente, mas estabelecer uma fundação nova, simples de operar e integrada ao runtime Edge.

A decisão anterior de usar PostgreSQL externo via Hyperdrive adicionaria um segundo provedor, connection strings, pooling e uma camada operacional extra antes de existir tráfego real no novo runtime.

Como nenhum banco Neon, Hyperdrive ou migração de dados foi criado, a arquitetura pode ser simplificada sem rollback de dados.

## Decisão

Adotar Cloudflare D1 como banco SQL principal da nova arquitetura:

```text
Cloudflare Workers + Hono
  -> ports de aplicação
  -> adapters D1 + Drizzle
  -> Cloudflare D1
```

Complementos previstos:

```text
D1               -> dados relacionais persistentes
Durable Objects  -> concorrência, coordenação e estado ativo
R2               -> arquivos e objetos
Queues           -> processamento assíncrono
Workflows        -> processos longos e retomáveis
Vectorize        -> busca semântica
```

## Estratégia inicial

- um banco D1 exclusivo de staging;
- binding `DB` acessível apenas ao Worker;
- feature flag `EDGE_DATABASE_ENABLED=false` por padrão;
- primeira consulta constante, sem tabela ou dado de negócio;
- nenhuma rota pública de dados nesta fase;
- migrations SQL versionadas no repositório;
- Drizzle usado para schema e consultas tipadas;
- D1 Workers Binding API permitido para operações operacionais mínimas, como o canário de conectividade.

## Isolamento e escala

O primeiro estágio usará um banco compartilhado com `tenant_id` obrigatório nas tabelas de negócio.

A arquitetura deve permitir evolução para múltiplos bancos menores:

```text
routing de tenant
  -> banco compartilhado por grupo
  -> shard por faixa de tenant
  -> banco dedicado para tenant grande
```

Nenhum domínio poderá assumir que existe apenas um banco físico. A resolução do banco deverá permanecer fora das regras de negócio.

## Concorrência

D1 não será usado isoladamente para coordenar disputas sensíveis.

Reservas de agenda, confirmações pendentes e estados concorrentes deverão usar Durable Objects ou outra coordenação determinística antes da persistência.

## Alternativas consideradas

### Neon PostgreSQL via Hyperdrive

Arquiteturalmente válido, mas adiado. Adicionaria outro provedor e complexidade operacional antes de o runtime novo possuir carga real.

PostgreSQL permanece uma alternativa futura para relatórios globais, cargas relacionais incompatíveis com D1 ou necessidades que ultrapassem os limites operacionais do modelo SQLite.

### Continuar no Supabase

Rejeitada como arquitetura-alvo. O novo runtime não deve depender de PostgREST, SDK ou serviços de plataforma do Supabase.

### Banco PostgreSQL autogerenciado

Rejeitado nesta fase por custo operacional, rede, segurança e manutenção prematuros.

## Consequências positivas

- uma única plataforma operacional principal;
- binding nativo sem connection string dentro do Worker;
- ambiente local e testes integrados ao runtime Workers;
- menor número de credenciais e provedores;
- escala horizontal futura por múltiplos bancos;
- disaster recovery e Time Travel gerenciados pela Cloudflare;
- cobrança baseada em uso e armazenamento.

## Consequências negativas

- semântica SQLite em vez de PostgreSQL;
- migrations legadas não podem ser aplicadas diretamente;
- cada banco possui limite físico e processamento serial de consultas;
- relatórios globais e consultas muito pesadas podem exigir estratégia separada;
- sharding e roteamento de tenants precisarão ser planejados antes de grande escala;
- concorrência de agenda exige coordenação fora do banco.

## Restrições

- nenhum SQL arbitrário vindo de requisições;
- `tenant_id` obrigatório em toda tabela multi-tenant;
- toda consulta de coleção deve possuir limite explícito;
- índices devem acompanhar os filtros de tenant e estado;
- migrations são imutáveis depois de aplicadas;
- nenhuma migration é aplicada automaticamente em produção;
- nenhum adapter D1 dentro do domínio;
- erros não podem expor SQL, dados, stack ou detalhes internos do binding;
- idempotência obrigatória em operações repetíveis.

## Critérios de revisão

A decisão será revisada antes do primeiro corte de produção e quando qualquer um destes sinais ocorrer:

- aproximação do limite de tamanho de um banco;
- sobrecarga persistente ou filas de consulta;
- necessidade de transações ou extensões incompatíveis;
- relatórios globais com custo ou latência inadequados;
- exigência regulatória de localização ainda não atendida;
- necessidade comprovada de PostgreSQL.
