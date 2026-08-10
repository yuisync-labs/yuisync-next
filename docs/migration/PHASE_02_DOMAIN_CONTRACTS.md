# Fase 2 — Contratos e limites de domínio

## Objetivo

Criar contratos versionados e limites explícitos entre domínio, aplicação e infraestrutura antes de introduzir qualquer runtime Cloudflare.

A fase preserva os provedores atuais. Express, Supabase, OpenAI e os caminhos legados continuam ativos. Os contratos e adapters novos permanecem fora do caminho crítico.

## Entregas concluídas

### Contratos V1

Foram implementados e exportados por `shared/contracts/v1/index.ts`:

- `TenantContextV1`;
- `InboundMessageV1`;
- `ProductOrderV1`;
- `ServiceBookingV1`;
- `PendingConfirmationV1`;
- `ToolResultV1`;
- `DomainEventEnvelopeV1`.

Todos possuem `type` e `version` explícitos, schemas estritos e funções de parse que retornam `ContractValidationError` sanitizado.

### Separação comercial

`ProductOrderV1` e `ServiceBookingV1` são contratos independentes.

O contrato de produto controla itens, pagamento, troco, retirada ou entrega e revalida o total. O contrato de serviço controla pet, serviço, agenda, duração, benefício, adicionais e MotoDog. Ele não possui forma de pagamento, troco ou entrega de produto e mantém `payment_status: a_receber`.

### Invariantes determinísticas

Os schemas verificam, entre outros pontos:

- total dos itens e taxa de entrega;
- troco somente para dinheiro;
- pagamento a combinar na retirada;
- total e duração de serviços e adicionais;
- benefício de plano zerando somente o serviço principal;
- raça, peso e decisão de transporte para banho/tosa;
- sintoma obrigatório e ausência de MotoDog no contrato veterinário;
- tenant idêntico entre confirmação e operação;
- estados coerentes de confirmação;
- resultados de ferramenta coerentes com sucesso, erro e retry;
- envelopes de evento JSON, versionados e idempotentes.

### Ports de aplicação

Foram criados ports puros para:

- relógio;
- geração de IDs;
- persistência de pedidos, reservas e confirmações;
- publicação de eventos;
- object storage;
- modelo de linguagem estruturado.

Esses ports não importam Express, Supabase, OpenAI, Cloudflare ou variáveis de ambiente.

### Adapters legados

Adapters em `server/infrastructure/adapters/contracts/` convertem o formato atual do PetBot em `ProductOrderV1` ou `ServiceBookingV1`.

Eles preservam tenant, idempotência, itens, totais, agenda e transporte, mas não controlam nenhuma rota. Falhas de conversão usam `LegacyContractAdapterError` sanitizado.

### Gates automáticos

A CI executa:

```text
npm run typecheck:contracts
npm run check:contract-boundaries
npm run test:contracts
```

O checker impede dependências de infraestrutura em contratos, domínio e aplicação, além de impedir `process.env` nessas camadas.

## Compatibilidade e adoção

- mudanças aditivas podem preservar V1 somente quando mantêm compatibilidade de leitura;
- remoção, renomeação ou mudança semântica exige nova versão;
- contratos persistidos ou enfileirados sempre carregam versão;
- adapters entram primeiro em observação;
- nenhuma rota passa a depender dos novos contratos sem comparação de paridade e feature flag explícita;
- o formato legado permanece disponível para rollback.

## Validação final

- 41 testes específicos de contratos e adapters;
- typecheck principal e typecheck dos contratos verdes;
- checker de limites arquiteturais verde;
- auditoria sem bloqueios não aceitos;
- Vitest legado verde;
- 198 testes do PetBot verdes;
- Luna unitária, regressões e avaliações determinísticas verdes;
- testes transacionais verdes;
- build verde;
- tenant isolation e E2E reportados como condicionais quando não há credenciais de homologação.

## Gates de saída

- [x] Zod instalado e lockfile reproduzível;
- [x] contratos V1 implementados e exportados por um único entrypoint;
- [x] casos válidos, inválidos e compatibilidade testados;
- [x] erros tipados não vazam dados sensíveis;
- [x] imports de infraestrutura proibidos nas novas pastas de domínio e aplicação;
- [x] adapters legados preservam os formatos atuais;
- [x] pedido de produto e reserva de serviço permanecem estruturalmente distintos;
- [x] typecheck, Vitest, PetBot, Luna, transações e build verdes;
- [x] nenhum schema, migration ou provedor alterado;
- [x] nenhuma rota produtiva controlada pelos novos contratos.

## Rollback

Os novos contratos, ports e adapters estão fora do caminho crítico. Reverter a PR remove essa fundação sem alterar banco, dados, autenticação, deploy ou infraestrutura externa.
