# Fase 4 — Fundação de acesso a dados

## Objetivo

Conectar o runtime Cloudflare a um PostgreSQL independente hospedado inicialmente no Neon, por meio do Hyperdrive, de forma controlada, tipada e somente leitura. Esta fase não migra dados do sistema atual, não altera schema e não substitui rotas do backend legado.

Fluxo-alvo desta fase:

```text
Cloudflare Worker
  -> port de consulta independente de provedor
  -> adapter Drizzle + node-postgres
  -> Hyperdrive de staging
  -> Neon PostgreSQL de staging
```

O código de aplicação não poderá depender de Neon, Hyperdrive, Drizzle ou `pg`. Esses detalhes ficam restritos aos adapters e à composição do runtime.

## Decisões da fase

- PostgreSQL continua como banco relacional principal.
- Neon será o provedor inicial de desenvolvimento, staging e, após validação, produção.
- Hyperdrive será a camada de conexão e pooling do runtime Workers.
- `node-postgres` (`pg`) será o driver do adapter Hyperdrive.
- Drizzle será usado para tipos e consultas explícitas.
- `@neondatabase/serverless` não será usado no caminho Hyperdrive.
- D1 não será usado como banco central nesta fase.
- Supabase não faz parte da arquitetura-alvo.

## Escopo

### Incluído

- port de acesso a dados independente de provedor;
- adapter PostgreSQL compatível com Cloudflare Workers;
- Drizzle para tipos e consultas explícitas;
- `pg` em versão compatível com Hyperdrive;
- binding Hyperdrive exclusivo de staging;
- projeto e branch Neon exclusivos de staging;
- role de banco dedicada e somente leitura;
- timeout, cancelamento e erros sanitizados;
- readiness separado para dependências externas;
- consulta canário sem dados pessoais;
- testes unitários, de integração e de isolamento;
- feature flag desligada por padrão;
- observabilidade sem SQL, parâmetros ou credenciais nos logs.

### Fora do escopo

- escrita no banco;
- migrations ou importação do banco legado;
- autenticação no Neon;
- Supabase Auth, PostgREST ou `@supabase/supabase-js` no runtime novo;
- D1 como banco principal;
- replicação ou migração de dados;
- rotas de catálogo, agenda, pedidos ou mensagens expostas ao público;
- conexão do Worker ao banco de produção atual;
- substituição do backend Express.

## Ordem de implementação

1. aceitar o ADR de provedor, driver e pooling;
2. inventariar os acessos atuais ao banco apenas para planejar a migração futura;
3. definir o port mínimo de consulta e tipos de erro;
4. adicionar feature flag `EDGE_DATABASE_ENABLED`, desligada por padrão;
5. instalar Drizzle, `pg` e tipos compatíveis;
6. criar adapter testável sem binding real;
7. criar projeto e branch Neon exclusivos de staging;
8. criar role PostgreSQL dedicada com acesso somente leitura;
9. criar Hyperdrive de staging usando a connection string direta, sem pooling do Neon;
10. adicionar binding Hyperdrive somente ao ambiente staging;
11. executar consulta canário sem dados sensíveis;
12. incluir dependência de banco no `/ready` somente quando a flag estiver habilitada;
13. validar logs, timeout e indisponibilidade;
14. ensaiar rollback desligando a flag e removendo o binding;
15. integrar somente após todos os gates.

## Regras de segurança

- nenhuma connection string no GitHub, código, logs ou documentação;
- o Worker recebe somente o binding Hyperdrive;
- a role do banco não pode criar, alterar, inserir, atualizar ou excluir;
- consultas devem possuir limite explícito e timeout;
- nenhuma consulta genérica aceita SQL vindo da requisição;
- nenhum dado pessoal será usado no primeiro teste;
- falhas externas retornam erro sanitizado e correlation ID;
- readiness deve distinguir configuração, conexão e consulta canário;
- a feature flag permanece desligada por padrão em local, test e staging até o gate operacional;
- nenhuma biblioteca do Neon pode atravessar o port de aplicação.

## Consulta canário

A primeira consulta será uma instrução constante, sem tabelas de negócio e sem parâmetros externos. Ela deverá confirmar:

- conectividade;
- execução em modo somente leitura;
- timeout controlado;
- resposta sanitizada;
- ausência de SQL e credenciais nos logs.

## Implementação validada antes da infraestrutura

- `ReadOnlyDatabasePort` independente de provedor;
- erros categorizados e sanitizados;
- feature flag fail-closed;
- readiness preservado com banco desabilitado;
- Drizzle ORM `0.45.x`;
- node-postgres `8.22.x`;
- adapter com `BEGIN READ ONLY`, consulta constante e `ROLLBACK`;
- timeouts de conexão, consulta e statement;
- fechamento do cliente garantido;
- testes determinísticos do gate e do resultado canário;
- CI completa verde no commit `619fe434500e98e1188f1ae3658ea9d945dbd1c2`.

## Gates obrigatórios

- [x] decisão PostgreSQL independente + Neon + Hyperdrive registrada;
- [ ] inventário das dependências de banco concluído;
- [x] ADR do driver e estratégia de pooling aceito;
- [x] port e adapter sem SDK dentro do domínio;
- [x] Drizzle e tipos verificados na CI;
- [x] testes em runtime Workers verdes;
- [x] feature flag desligada por padrão;
- [ ] projeto/branch Neon de staging criado;
- [ ] role PostgreSQL somente leitura criada;
- [ ] Hyperdrive de staging criado e vinculado;
- [ ] consulta canário aprovada;
- [ ] timeout e indisponibilidade testados ao vivo;
- [ ] logs sem SQL, parâmetros, PII ou secrets validados no staging;
- [ ] rollback do binding/flag ensaiado;
- [x] nenhuma regressão no legado.

## Rollback

O rollback lógico consiste em desligar `EDGE_DATABASE_ENABLED`. O rollback de infraestrutura consiste em remover o binding Hyperdrive do ambiente de staging. Como esta fase não permite escrita nem mudança de schema, não existe rollback de dados.

## Critério de saída

A fase termina quando o Worker consegue validar, sob feature flag e em staging, uma conexão somente leitura com Neon PostgreSQL via Hyperdrive, usando um adapter tipado, com testes, observabilidade, timeout e rollback comprovados, sem expor rota de negócio nem alterar o comportamento do sistema atual.
