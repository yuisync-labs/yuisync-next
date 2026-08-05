# Fase 4 — Fundação de acesso a dados

## Objetivo

Conectar o runtime Cloudflare ao PostgreSQL/Supabase atual de forma controlada, tipada e inicialmente somente leitura, sem migrar dados, alterar schema ou substituir rotas do backend legado.

Fluxo-alvo desta fase:

```text
Cloudflare Worker
  -> port de consulta
  -> adapter PostgreSQL compatível com Workers
  -> Hyperdrive de staging
  -> PostgreSQL/Supabase atual
```

## Escopo

### Incluído

- port de acesso a dados independente de provedor;
- adapter PostgreSQL compatível com Cloudflare Workers;
- Drizzle para tipos e consultas explícitas;
- binding Hyperdrive exclusivo de staging;
- usuário de banco dedicado e somente leitura;
- timeout, cancelamento e erros sanitizados;
- readiness separado para dependências externas;
- consulta canário sem dados pessoais;
- testes unitários, de integração e de isolamento;
- feature flag desligada por padrão;
- observabilidade sem SQL, parâmetros ou credenciais nos logs.

### Fora do escopo

- escrita no banco;
- migrations;
- troca do Supabase Auth;
- D1;
- replicação ou migração de dados;
- rotas de catálogo, agenda, pedidos ou mensagens expostas ao público;
- conexão com produção;
- alteração de políticas RLS existentes;
- substituição do backend Express.

## Ordem de implementação

1. inventariar o acesso atual ao PostgreSQL e as tabelas candidatas;
2. definir o port mínimo de consulta e tipos de erro;
3. instalar Drizzle e driver compatível com Workers;
4. criar adapter testável sem binding real;
5. adicionar feature flag `EDGE_DATABASE_ENABLED=false`;
6. adicionar binding Hyperdrive apenas no ambiente de staging;
7. criar usuário PostgreSQL dedicado com `CONNECT` e `SELECT` somente nas relações necessárias;
8. executar consulta canário sem dados sensíveis;
9. incluir dependência de banco no `/ready` somente quando a flag estiver habilitada;
10. validar logs, timeout e indisponibilidade;
11. ensaiar rollback removendo o binding/flag;
12. integrar somente após todos os gates.

## Regras de segurança

- nenhuma connection string no GitHub, código, logs ou documentação;
- o Worker recebe somente o binding Hyperdrive;
- o usuário de banco não pode criar, alterar, inserir, atualizar ou excluir;
- consultas devem possuir limite explícito e timeout;
- nenhuma consulta genérica aceita SQL vindo da requisição;
- nenhum dado pessoal será usado no primeiro teste;
- falhas externas retornam erro sanitizado e correlation ID;
- readiness deve distinguir configuração, conexão e consulta canário;
- a feature flag permanece desligada por padrão em local, test e staging até o gate operacional.

## Consulta canário

A primeira consulta deverá validar apenas conectividade e identidade do banco, sem ler tabelas de negócio ou dados de tenant. A forma exata será escolhida após confirmar o driver e as restrições do ambiente.

## Gates obrigatórios

- [ ] inventário das dependências de banco concluído;
- [ ] ADR do driver e estratégia de pooling aceito;
- [ ] port e adapter sem SDK dentro do domínio;
- [ ] Drizzle e tipos verificados na CI;
- [ ] testes em runtime Workers verdes;
- [ ] feature flag desligada por padrão;
- [ ] usuário PostgreSQL somente leitura criado;
- [ ] Hyperdrive de staging criado e vinculado;
- [ ] consulta canário aprovada;
- [ ] timeout e indisponibilidade testados;
- [ ] logs sem SQL, parâmetros, PII ou secrets;
- [ ] rollback do binding/flag ensaiado;
- [ ] nenhuma regressão no legado.

## Rollback

O rollback lógico consiste em desligar `EDGE_DATABASE_ENABLED`. O rollback de infraestrutura consiste em remover o binding Hyperdrive do ambiente de staging. Como esta fase não permite escrita nem mudança de schema, não existe rollback de dados.

## Critério de saída

A fase termina quando o Worker consegue validar, sob feature flag e em staging, uma conexão somente leitura via Hyperdrive, com testes, observabilidade, timeout e rollback comprovados, sem expor rota de negócio nem alterar o comportamento do sistema atual.
