# ADR-0002 — PostgreSQL independente no Neon via Hyperdrive

- Status: accepted
- Data: 2026-08-06
- Decisores: YuiSync

## Contexto

O YuiSync precisa sair do Supabase como plataforma sem trocar simultaneamente o modelo relacional, o runtime e a semântica do banco. O sistema possui pedidos, agendamentos, pagamentos, fiscal, tenants e operações transacionais que continuam adequadas ao PostgreSQL.

O novo runtime será executado em Cloudflare Workers. Conexões diretas e repetidas de runtimes distribuídos a um banco regional precisam de pooling, gerenciamento de conexões e uma estratégia compatível com Workers.

## Decisão

Adotar:

```text
Cloudflare Workers
  -> port de aplicação
  -> adapter Drizzle + node-postgres
  -> Cloudflare Hyperdrive
  -> Neon PostgreSQL
```

### Provedor

Neon será o provedor PostgreSQL inicial para desenvolvimento, staging e, após os gates de operação, produção.

O código de domínio e aplicação continuará independente do Neon. A troca futura por RDS, Aurora, Cloud SQL ou PostgreSQL administrado não poderá exigir mudanças nas regras de negócio.

### Driver

O adapter Hyperdrive usará `node-postgres` (`pg`) em versão superior a `8.16.3`, com uma instância de cliente por operação/requisição. O pooling da conexão de origem será responsabilidade do Hyperdrive.

O driver `@neondatabase/serverless` não será usado no caminho conectado ao Hyperdrive.

### ORM e schema

Drizzle será usado para:

- tipos de tabelas;
- consultas explícitas;
- parâmetros tipados;
- futura gestão de migrations do banco novo.

A Fase 4 não executará migrations nem importará tabelas do sistema atual.

### Segurança inicial

A primeira conexão terá:

- projeto e branch Neon exclusivos de staging;
- role exclusiva para o Hyperdrive;
- acesso somente leitura;
- feature flag desligada por padrão;
- consulta canário constante, sem dados de negócio;
- nenhum endpoint público de dados.

## Alternativas consideradas

### Continuar no Supabase

Rejeitada como arquitetura-alvo. Manteria dependência de PostgREST, SDK e serviços da plataforma que não são necessários para o runtime novo.

### D1 como banco principal imediato

Rejeitada nesta etapa. Exigiria migrar PostgreSQL para SQLite/D1 ao mesmo tempo em que o runtime está sendo substituído, aumentando o risco de diferenças de SQL, transações, concorrência e particionamento.

D1 permanece candidato para idempotência, checkpoints e dados operacionais simples.

### PostgreSQL em RDS/Aurora

Arquiteturalmente válido e compatível com o port. Não escolhido agora por exigir mais operação, rede e custo antes de o novo runtime alcançar tráfego real.

### Conectar Workers diretamente ao Neon sem Hyperdrive

Válido tecnicamente, mas não escolhido como caminho principal. Hyperdrive centraliza pooling e roteamento de consultas na rede Cloudflare e mantém o adapter compatível com drivers PostgreSQL tradicionais.

## Consequências positivas

- remoção gradual da dependência do Supabase;
- preservação das propriedades relacionais e transacionais do PostgreSQL;
- portabilidade entre provedores PostgreSQL;
- pooling gerenciado para Workers;
- possibilidade de branches isoladas para staging e testes;
- migração de dados separada da migração de runtime.

## Consequências negativas

- operação passa a envolver Cloudflare e Neon;
- Hyperdrive adiciona uma camada de infraestrutura e configuração;
- autenticação, storage e recursos antes fornecidos pelo Supabase precisarão de soluções próprias;
- será necessário criar e auditar roles, grants e migrations.

## Restrições

- nenhuma referência a Neon, Hyperdrive, Drizzle ou `pg` dentro do domínio;
- nenhuma connection string versionada;
- nenhuma conexão ao banco de produção atual nesta fase;
- nenhuma escrita na Fase 4;
- nenhuma consulta SQL recebida pela requisição;
- todos os erros externos devem ser sanitizados.

## Critérios de revisão

Esta decisão deve ser reavaliada antes do primeiro banco de produção quando houver dados de carga, custo, latência, recuperação e operação do staging.
