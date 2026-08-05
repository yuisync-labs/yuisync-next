# Contratos compartilhados

Este diretório contém os contratos canônicos usados entre entradas, casos de uso, domínio e adapters do YuiSync.

## Propósito

Os contratos existem para impedir que formatos específicos de Express, Supabase, OpenAI, Vercel ou Cloudflare se tornem o modelo interno da aplicação.

Eles não substituem entidades de domínio nem representam diretamente tabelas do banco.

## Regras

### Versão explícita

Cada contrato público ou persistido possui uma versão no nome exportado e, quando serializado, no campo `version`.

Exemplo conceitual:

```js
{
  type: 'service_booking',
  version: 1,
  tenant_id: 'tenant-id',
  payload: {}
}
```

### Parse nas bordas

Payloads não confiáveis são validados na entrada:

- HTTP;
- webhooks;
- mensagens recebidas;
- filas;
- arquivos importados;
- respostas estruturadas de modelos;
- leitura de dados legados sem garantia de formato.

O domínio recebe valores já validados.

### Saída serializável

Contratos persistidos, enfileirados ou usados em eventos devem ser serializáveis em JSON. Não utilizar:

- instâncias de SDK;
- objetos `Request` ou `Response`;
- conexões de banco;
- funções;
- símbolos;
- erros nativos sem conversão;
- datas como objetos `Date`.

Datas e horários são strings ISO acompanhadas da semântica necessária de timezone.

### Ausência, vazio e nulo

- campo ausente: não informado ou não aplicável no formato de entrada;
- `null`: ausência explícita permitida pelo contrato;
- string vazia: rejeitada, salvo quando possuir significado funcional documentado;
- valores padrão: aplicados apenas pelo caso de uso ou schema que seja autoridade para essa regra.

### Dados sensíveis

Erros de validação devem informar caminho, código e mensagem segura. Nunca incluir automaticamente:

- tokens;
- secrets;
- chaves de API;
- conteúdo integral de mensagens;
- documentos pessoais completos;
- credenciais de banco;
- headers de autenticação.

### Separação produto e serviço

`ProductOrderV1` e `ServiceBookingV1` são contratos distintos.

`ProductOrderV1` pode conter pagamento, troco, entrega ou retirada.

`ServiceBookingV1` contém serviço, pet, agenda, transporte do pet e estado de confirmação. Ele não possui campos de pagamento de produto, troco, entrega de mercadoria ou retirada de compra.

### Tenant obrigatório

Operações de aplicação recebem `TenantContextV1` ou um identificador de tenant derivado dele. Nenhum adapter deve inferir silenciosamente um tenant global.

### Evolução

- adição opcional compatível pode permanecer na mesma versão;
- mudança de significado, remoção ou renomeação exige nova versão;
- adapters de leitura devem aceitar versões suportadas e converter para a representação canônica atual;
- versões desconhecidas são rejeitadas com erro tipado;
- migrations de mensagens ou dados persistidos devem ser explícitas e testáveis.

## Dependências permitidas

Contratos podem importar apenas:

- Zod;
- outros contratos da mesma camada;
- utilitários puros, determinísticos e sem acesso a ambiente ou I/O.

Não são permitidos imports de:

- `express`;
- `@supabase/*`;
- SDKs de modelo;
- SDKs Cloudflare;
- módulos de banco;
- `process.env`;
- arquivos de rotas, controllers ou jobs.

## Entry point

Após a primeira implementação, todos os contratos estáveis serão exportados por `shared/contracts/v1/index.*`. Consumidores não devem importar arquivos internos que não pertençam ao entrypoint público.

## Testes mínimos por contrato

Cada schema deve cobrir:

1. payload válido mínimo;
2. payload válido completo;
3. campos obrigatórios ausentes;
4. strings vazias e limites;
5. valores desconhecidos em enums;
6. campos extras conforme a política do contrato;
7. serialização e parse de ida e volta;
8. sanitização do erro;
9. compatibilidade com fixtures legadas relevantes;
10. isolamento de tenant quando aplicável.
