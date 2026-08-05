# Fase 2 — Contratos e limites de domínio

## Objetivo

Criar contratos versionados e limites explícitos entre domínio, aplicação e infraestrutura antes de introduzir qualquer runtime Cloudflare.

A fase preserva os provedores atuais. Express, Supabase, OpenAI e os caminhos legados continuam ativos enquanto passam a ser envolvidos por ports e adapters testáveis.

## Escopo

1. introduzir Zod como biblioteca de validação de contratos;
2. definir convenções de versão, compatibilidade e evolução;
3. criar erros tipados e serializáveis;
4. separar estruturalmente pedido de produto e reserva de serviço;
5. definir ports para banco, fila, modelo, storage, relógio e geração de IDs;
6. envolver integrações legadas com adapters sem alterar o tráfego;
7. adicionar checagem automática de dependências proibidas nas novas pastas de domínio.

## Primeira fatia

A implementação começa pelos contratos que já possuem invariantes críticos e testes de caracterização:

- `TenantContextV1`;
- `InboundMessageV1`;
- `ProductOrderV1`;
- `ServiceBookingV1`;
- `PendingConfirmationV1`;
- `ToolResultV1`;
- `DomainEventEnvelopeV1`.

A separação entre `ProductOrderV1` e `ServiceBookingV1` é obrigatória. Campos de pagamento, troco, entrega e retirada não pertencem ao contrato de agendamento de serviço.

## Estrutura-alvo inicial

```text
shared/contracts/
  README.md
  v1/
    tenant-context.*
    inbound-message.*
    product-order.*
    service-booking.*
    confirmation.*
    tool-result.*
    domain-event.*

server/domain/
  */

server/application/
  ports/

server/infrastructure/
  adapters/
```

Os nomes finais serão confirmados ao implementar a primeira fatia. Nenhuma movimentação ampla de arquivos será feita apenas para reproduzir essa árvore.

## Regras de dependência

- contratos podem depender de Zod e utilitários puros;
- domínio pode depender de contratos, mas não de Express, Supabase, OpenAI, Cloudflare ou variáveis de ambiente;
- aplicação pode depender de domínio, contratos e ports;
- adapters podem depender de SDKs e provedores;
- entradas HTTP, jobs e webhooks compõem os casos de uso e adapters;
- código de domínio não acessa `process.env` diretamente;
- código de domínio não importa bindings Cloudflare diretamente.

## Compatibilidade

- todo contrato externo possui versão explícita;
- mudanças aditivas preservam a versão quando mantêm compatibilidade de leitura;
- remoção, renomeação ou mudança semântica exige nova versão;
- adapters convertem formatos legados para contratos canônicos;
- mensagens persistidas ou enfileiradas nunca dependem apenas da versão do código em execução;
- erros de validação não podem expor secrets, tokens ou payloads sensíveis completos.

## Estratégia de adoção

1. definir schema e testes;
2. adicionar adapter do formato legado para o contrato;
3. executar o adapter em modo observação, sem controlar o fluxo;
4. comparar resultado canônico com o comportamento atual;
5. ativar por feature flag somente após paridade;
6. manter rollback para o caminho legado durante a fase.

## Gates de saída

- [ ] Zod instalado e lockfile reproduzível;
- [ ] contratos V1 implementados e exportados por um único entrypoint;
- [ ] casos válidos, inválidos e compatibilidade testados;
- [ ] erros tipados não vazam dados sensíveis;
- [ ] imports de infraestrutura proibidos nas novas pastas de domínio;
- [ ] adapters legados preservam os formatos atuais;
- [ ] pedido de produto e reserva de serviço permanecem estruturalmente distintos;
- [ ] typecheck, Vitest, PetBot, Luna, transações e build verdes;
- [ ] nenhum schema, migration ou provedor alterado;
- [ ] nenhuma rota produtiva controlada pelos novos contratos sem feature flag.

## Riscos

- duplicar validações sem definir uma fonte canônica;
- converter `null`, ausência e string vazia de forma incompatível;
- misturar DTO de transporte com entidade de domínio;
- mover arquivos demais e dificultar a revisão;
- introduzir dependência circular entre contratos e adapters;
- validar payloads sensíveis e registrar o conteúdo integral em logs;
- transformar a fase em reescrita funcional de PetBot ou Luna.

## Rollback

Os novos contratos e adapters começam fora do caminho crítico. O rollback consiste em desativar as feature flags e remover a composição nova. O formato legado continua disponível durante toda a fase.

Não há mudança de banco, dados, autenticação, deploy ou infraestrutura externa nesta fase.
