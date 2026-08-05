# Fase 1 — Safety net

## Objetivo

Transformar a CI e o ambiente de desenvolvimento em uma fonte confiável de diagnóstico antes de qualquer mudança de domínio, runtime ou infraestrutura.

## Escopo

1. alinhar Node local, `package.json`, documentação e GitHub Actions;
2. separar auditoria de segurança dos testes funcionais;
3. corrigir advisories bloqueantes sem ocultá-los em allowlists permanentes;
4. executar e classificar toda a suíte existente;
5. documentar testes instáveis, condicionais ou dependentes de credenciais;
6. estabelecer gates mínimos para as fases seguintes.

## Diagnóstico inicial

- `.nvmrc` e `package.json` definem Node 22;
- a CI executava Node 24;
- o README aceitava Node 18+;
- `npm run audit:ci` era o primeiro passo do único job de qualidade;
- o advisory de `undici` interrompia o job antes de typecheck, testes e build;
- `undici` entra na árvore como dependência de desenvolvimento do `jsdom`;
- testes de tenant e E2E dependem de secrets de homologação e são condicionais;
- ao liberar a execução da suíte completa, um teste do PetBot revelou que opções padrão de MotoDog eram anexadas mesmo quando o tenant possuía uma lista explícita própria.

## Mudanças realizadas

### CI

- `.nvmrc` passou a ser a fonte única da versão do Node;
- `security-audit`, `quality` e `e2e` são jobs independentes;
- um advisory não impede a execução dos testes funcionais;
- execuções antigas da mesma branch são canceladas;
- o workflow usa permissão mínima de leitura do conteúdo.

### Dependências

- `undici` foi fixado em `7.29.0` por `overrides`, dentro da linha 7.x aceita pelo `jsdom` e compatível com Node 22;
- o lockfile foi regenerado;
- `npm run audit:ci` foi validado sem adicionar `undici` à allowlist;
- advisories previamente aceitos continuam com prazo explícito de revisão.

### PetBot

- a lista explícita de opções de transporte do tenant passou a ser autoritativa;
- as opções padrão são usadas somente quando a loja não configurou nenhuma opção;
- o teste de caracterização existente permanece como proteção contra regressão.

Essa correção funcional é restrita à regressão descoberta pela safety net e não altera contratos de pedido, agenda, banco ou integrações externas.

### Testes

- confirmar `typecheck`;
- confirmar testes Vitest;
- confirmar matrizes PetBot;
- confirmar Luna unitária, regressões e evals determinísticos;
- confirmar testes transacionais;
- confirmar build Vite;
- registrar explicitamente quando tenant/E2E forem ignorados por ausência de secrets.

## Gates de saída

A Fase 1 somente termina quando:

- [x] `npm ci` funciona em Node 22;
- [x] `npm run audit:ci` não possui bloqueios não aceitos;
- [ ] typecheck está verde;
- [ ] testes unitários estão verdes;
- [x] PetBot está verde;
- [ ] Luna está verde;
- [ ] testes transacionais estão verdes;
- [ ] build está verde;
- [ ] skips condicionais aparecem de forma clara na CI;
- [x] não foi identificado teste instável sem classificação ou plano.

## Fora de escopo

- Hono, Wrangler ou Workers;
- reorganização de domínios ou pastas de produção;
- migração de rotas;
- alteração de schema ou migrations;
- mudança de autenticação;
- mudanças amplas de comportamento em PetBot ou Luna.

## Rollback

As mudanças desta fase são restritas a CI, documentação, dependências de desenvolvimento e à precedência da configuração de transporte do tenant. O rollback consiste em reverter a PR; não há alteração de dados ou infraestrutura externa.
