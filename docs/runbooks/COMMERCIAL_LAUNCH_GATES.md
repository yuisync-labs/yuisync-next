# Lançamento comercial: implementação e critérios pendentes

Atualização: 2026-09-05. Escopo: até dez empresas com implantação assistida e WhatsApp humano. Luna e fiscal não fazem parte desta entrega.

## Implementado neste conjunto, ainda sem publicação

- Política de cargo, vínculo e empresa ativa aplicada à entrada das rotas Petshop e à compatibilidade Petshop; proteção direta do catálogo de serviços. Objetos de permissão sem cargo reconhecido não autorizam administração. Checkout também valida os cargos reconhecidos.
- COUNT da compatibilidade executado apenas quando solicitado explicitamente com `count: 'exact'`. O restante retorna `count: null`.
- Envelope externo de request ID, duração, status e erro inesperado; logs usam famílias de rota, sem IDs de registros ou tokens na URL.
- Minha conta, troca autenticada e recuperação de senha com token temporário, revogação de sessões, limitação de tentativas persistida no AUTH_DB e adaptador REST de e-mail. Falhas de entrega geram evento sanitizado e resposta pública indistinguível de conta inexistente.
- Provisionamento de empresa com chave idempotente e defaults neutros. Equipe operacional deixa de ser truncada em quatro pessoas; configurações existentes permanecem preservadas.
- CI rejeita falta de configuração de E2E/isolamento. Publicação final exige certificação do mesmo commit, sem herdar resultado de outro SHA.

Isto não certifica todas as APIs, nem remove a compatibilidade: o inventário continua em 207 `.from()` e 11 `.rpc()` no frontend. O runtime de compatibilidade usa D1. A conversão por domínio permanece pendente.

## Ordem obrigatória para homologar/publicar

1. Aplicar `apps/edge-api/auth-migrations/0003_auth_rate_limit.sql` primeiro em AUTH_DB de staging. É aditiva; não remover migrations já aplicadas.
2. Configurar secrets do Worker `AUTH_EMAIL_API_KEY` e `AUTH_EMAIL_FROM` com remetente verificado. Nunca utilizar variáveis `VITE_*` para esses valores.
3. Configurar credenciais de duas empresas fictícias isoladas no CI (`E2E_BASE_URL`, `TENANT_A_*`, `TENANT_B_*`) e contas E2E administrador, funcionário e gerente. Não usar o tenant real como fixture.
4. Resolver o build externo de staging e certificar exatamente o SHA candidato. Não substituir testes ausentes por aprovação manual.
5. Validar entrega real de e-mail, troca autenticada, expiração/reutilização de token e revogação de sessões. `/ready` informa configuração de recuperação, mas configuração não comprova entrega.
6. Somente depois dos gates completos, aplicar a migration aditiva em AUTH_DB de produção e promover o mesmo commit certificado. Registrar versões e smoke pontual. Não publicar antecipadamente o Worker que exige a tabela `rateLimit`.

## Evidências e limitações

- Validação local em 2026-09-05: Worker 68 arquivos/263 testes (`--maxWorkers=1`), frontend 14 arquivos/56 testes, contratos 8 arquivos/53 testes e transações 53 testes aprovados. Typechecks do frontend, contratos e Worker, build e `git diff --check` aprovados. A execução Worker sem limite foi interrompida após falhas; os dois casos apontados passaram isoladamente e a suíte inteira passou com concorrência limitada (362 s).
- Gate de credenciais testado negativamente: configuração ausente retorna código de saída 1. Isto testa o bloqueio, não a certificação externa.
- Testes locais de recuperação usam AUTH_DB local e transporte de e-mail simulado; nenhum e-mail real foi enviado.
- Consultas `EXPLAIN QUERY PLAN` de clientes e agenda em staging apontaram índices de chave/agenda; ambas reportaram zero linhas lidas/escritas. Isso não mede o custo de todos os percursos.
- Consulta de logs do build externo foi recusada com HTTP 403. Corrigir permissão de leitura de Workers Builds para diagnosticar; não expor tokens em logs.
- Secrets de e-mail e credenciais completas de certificação não estavam configurados na inspeção. Nenhuma carga ou varredura do banco de produção foi realizada nesta etapa.

## Ainda necessário antes da liberação comercial

- Certificação real E2E e isolamento, incluindo empresa inativa, acesso cruzado e chamadas administrativas diretas por funcionário.
- Regressões de agenda, unha/tosas, comissão sem responsável, cancelamento/reserva, consumo editável, reenvio idempotente e concorrência no último benefício/estoque/caixa.
- WhatsApp por empresa: conexão, recebimento/envio, reconexão e eventos duplicados/fora de ordem com números autorizados.
- Comprovantes 58 mm, 80 mm e PDF; teclado, celular e contraste dos percursos completos.
- Paginação e agregação nativas por domínio, medição por percurso de `rows_read`, alertas e interrupção automática ao orçamento de 500 mil leituras por rodada em staging.
- Carga somente em staging: dez empresas, cinco sessões por empresa, trinta minutos. Metas: erros inesperados abaixo de 1%, nenhuma divergência financeira, p95 de consultas abaixo de 1 s e gravações internas abaixo de 2 s.
- Ensaio de restauração isolada de dados/autenticação e rollback de código; política de retenção dos registros de rate limit.
- Provisionamento completo de catálogo, horários, regras e administrador; revisão dos defaults específicos restantes sem alterar histórico do Quatro Patas.
- Duas empresas piloto apenas após bloqueadores e WhatsApp certificados; expansão para dez após sete dias sem incidentes críticos e custo medido.

Não classificar o produto como “100% pronto” enquanto estes critérios não tiverem evidência registrada.
