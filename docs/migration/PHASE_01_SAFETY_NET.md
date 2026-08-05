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
- testes de tenant e E2E dependem de secrets de homologação e são condicionais.

## Mudanças planejadas

### CI

- usar `.nvmrc` como fonte única da versão do Node;
- manter `security-audit`, `quality` e `e2e` como jobs independentes;
- impedir que um advisory esconda regressões funcionais;
- cancelar execuções antigas da mesma branch;
- conceder somente permissão de leitura do conteúdo.

### Dependências

- atualizar a resolução transitiva vulnerável de `undici` para uma versão corrigida compatível com o range do `jsdom`;
- executar `npm audit` após regeneração do lockfile;
- não adicionar `undici` à allowlist;
- revisar advisories temporariamente aceitos e seus prazos.

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

- [ ] `npm ci` funciona em Node 22;
- [ ] `npm run audit:ci` não possui bloqueios não aceitos;
- [ ] typecheck está verde;
- [ ] testes unitários estão verdes;
- [ ] PetBot está verde;
- [ ] Luna está verde;
- [ ] testes transacionais estão verdes;
- [ ] build está verde;
- [ ] skips condicionais aparecem de forma clara na CI;
- [ ] qualquer teste instável possui issue, responsável e plano de correção.

## Fora de escopo

- Hono, Wrangler ou Workers;
- reorganização de pastas;
- migração de rotas;
- alteração de schema ou migrations;
- mudança de autenticação;
- mudanças funcionais em PetBot ou Luna.

## Rollback

As mudanças desta fase são restritas a CI, documentação e dependências de desenvolvimento. O rollback consiste em reverter a PR; não há alteração de dados ou infraestrutura externa.
