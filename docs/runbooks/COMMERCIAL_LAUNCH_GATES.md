# Lançamento comercial: implementação e critérios pendentes

Atualização: 2026-09-07. Escopo: até dez empresas com implantação assistida e WhatsApp humano. Luna e fiscal não fazem parte desta entrega.

## Implementado e já promovido nos ciclos anteriores

- Política de cargo, vínculo e empresa ativa aplicada à entrada das rotas Petshop e à compatibilidade Petshop; proteção direta do catálogo de serviços. Objetos de permissão sem cargo reconhecido não autorizam administração. Checkout também valida os cargos reconhecidos.
- COUNT da compatibilidade executado apenas quando solicitado explicitamente com `count: 'exact'`. O restante retorna `count: null`.
- Envelope externo de request ID, duração, status e erro inesperado; logs usam famílias de rota, sem IDs de registros ou tokens na URL.
- Minha conta, troca autenticada e recuperação de senha com token temporário, revogação de sessões, limitação de tentativas persistida no AUTH_DB e adaptador REST de e-mail. Falhas de entrega geram evento sanitizado e resposta pública indistinguível de conta inexistente.
- Provisionamento de empresa com chave idempotente e defaults neutros. Equipe operacional deixa de ser truncada em quatro pessoas; configurações existentes permanecem preservadas.
- Configuração de identidade/comprovantes por empresa e impressão compartilhada 58 mm, 80 mm e A4/PDF foram promovidas com certificação por SHA.
- Pacotes passaram a expor capacidade, saldo, reservas, consumo e origem; comissões não aplicam regra atual retroativamente quando o snapshot histórico está ausente.
- CI rejeita falta de configuração de E2E/isolamento. Publicação final exige certificação do mesmo commit, sem herdar resultado de outro SHA.

Isto não certifica todas as APIs, nem remove a compatibilidade: o inventário atual está em 206 `.from()` e 11 `.rpc()` no frontend. O runtime de compatibilidade usa D1. A conversão por domínio permanece pendente.

## Entrega 3 — Agenda e consistência das abas

Implementação candidata em `codex/delivery3-agenda-consistency`:

- A cadeia ativa foi confirmada como `modules.jsx -> AgendaPackageIntegratedPage -> AgendaIntegratedPage -> AgendaResolvedPage -> AgendaPage` antes da alteração.
- Clique no card da Agenda abre um painel de atendimento nativo sem substituir a Agenda: no desktop, a grade permanece ao lado; em viewport móvel, o mesmo primitive usa apresentação sobreposta com largura limitada à viewport.
- O painel consolida atendimento, serviços, responsável, pacote, pagamento e os últimos atendimentos do cliente. O histórico usa o Worker/D1 por `client_id`, ordenação decrescente e limite padrão de 12, com limite duro máximo de 50.
- Editar, avançar status e concluir continuam usando os comandos nativos já existentes. Conclusão de tosa com máquina salva `status` e `grooming_machine_no` na mesma atualização nativa.
- Atualizações mantêm os dados atuais visíveis e usam loading somente na região afetada. Erros de escrita mantêm o estado anterior porque a coleção local só é alterada depois de resposta bem-sucedida do Worker.
- Ao fechar o painel, data, filtros e estado da Agenda permanecem montados; a posição vertical anterior é restaurada. Escape fecha o painel e o foco retorna ao elemento anterior.
- O primitive respeita `motion-reduce`; não introduz reconstrução de estado de domínio a partir do DOM.
- A semântica de arraste existente permanece separada do clique. A regressão de drag agora exige também que mover um card não abra o painel.
- O caminho novo do painel não adiciona chamadas Supabase/compat. O `ClientHistoryGroomingEnhancer` legado continua existindo para entradas antigas/Clientes & Pets e ainda conta no inventário de compatibilidade; ele não é fonte de dados do novo painel da Agenda.

Evidência focada antes da PR:

- `agendaPanelPresentation.test.js`: 3/3 testes aprovados.
- `check:product-ui`, `check:no-domain-state-from-dom` e `check:appointment-edit-semantics`: aprovados.
- Edge typecheck e `appointmentCommandIntegration.test.ts`: aprovados.
- Build Vite: aprovado.
- Playwright do painel: desktop, preservação de filtro/foco/Escape e viewport móvel aprovados após instalar explicitamente o Chromium do runner.
- Nenhuma migration foi criada para a Entrega 3.

A Entrega 3 só deve ser considerada publicada depois de Quality da PR, Quality do SHA mesclado, certificação completa de staging incluindo browser contra o `/release` servido e promoção formal desse mesmo SHA para produção.

## Ordem obrigatória para homologar/publicar

1. Aplicar `apps/edge-api/auth-migrations/0003_auth_rate_limit.sql` primeiro em AUTH_DB de staging quando aplicável a um ambiente ainda não migrado. Não remover migrations já aplicadas.
2. Manter secrets do Worker `AUTH_EMAIL_API_KEY` e `AUTH_EMAIL_FROM` configurados com remetente verificado. Nunca utilizar variáveis `VITE_*` para esses valores.
3. Manter credenciais de duas empresas fictícias isoladas no CI (`E2E_BASE_URL`, `TENANT_A_*`, `TENANT_B_*`) e contas E2E administrador, funcionário e gerente. Não usar o tenant real como fixture.
4. Certificar exatamente o SHA candidato em staging. Não substituir testes ausentes por aprovação manual.
5. Manter a validação de recuperação de senha nos gates; `/ready` informa configuração de recuperação, mas configuração não comprova entrega real em caixa postal.
6. Somente depois dos gates completos, promover o mesmo commit certificado. Registrar versões, bookmarks de rollback e smoke live.

## Evidências e limitações gerais

- Os ciclos de release usam Quality completo, staging por SHA exato e produção por SHA exato; os últimos releases publicados preservaram schema D1 v30 e password recovery configurado.
- Testes locais de recuperação usam AUTH_DB local e transporte de e-mail simulado; configuração do provider não substitui teste de entrega real a uma caixa postal.
- Consultas `EXPLAIN QUERY PLAN` de clientes e agenda em inspeção anterior apontaram índices de chave/agenda; isso não mede o custo de todos os percursos.
- A compatibilidade frontend ainda existe em 206 `.from()` / 11 `.rpc()` e deve continuar reduzindo por domínio, sem aumentos permitidos pelo ratchet.
- O `ClientHistoryGroomingEnhancer` ainda usa compatibilidade em percursos legados; a Entrega 3 migra o histórico exibido pelo novo painel da Agenda, não elimina o enhancer inteiro.
- Nenhum teste de carga comercial de dez empresas foi executado por esta entrega.

## Ainda necessário antes da liberação comercial ampla

- Continuar a certificação de isolamento incluindo empresa inativa, acesso cruzado e chamadas administrativas diretas por funcionário nos domínios ainda não cobertos.
- Ampliar regressões combinadas de unha/tosas, comissão sem responsável/regra histórica, cancelamento/reserva, consumo editável, reenvio idempotente e concorrência no último benefício/estoque/caixa.
- WhatsApp por empresa: conexão, recebimento/envio, reconexão e eventos duplicados/fora de ordem com números autorizados.
- Continuar validação de teclado, celular e contraste nos percursos fora da Agenda e dos comprovantes já cobertos.
- Paginação e agregação nativas por domínio, medição por percurso de `rows_read`, alertas e interrupção automática ao orçamento de 500 mil leituras por rodada em staging.
- Carga somente em staging: dez empresas, cinco sessões por empresa, trinta minutos. Metas: erros inesperados abaixo de 1%, nenhuma divergência financeira, p95 de consultas abaixo de 1 s e gravações internas abaixo de 2 s.
- Ensaio de restauração isolada de dados/autenticação e rollback de código; política de retenção dos registros de rate limit.
- Provisionamento completo de catálogo, horários, regras e administrador; revisão dos defaults específicos restantes sem alterar histórico do Quatro Patas.
- Duas empresas piloto apenas após bloqueadores e WhatsApp certificados; expansão para dez após sete dias sem incidentes críticos e custo medido.

Não classificar o produto como “100% pronto” enquanto estes critérios não tiverem evidência registrada.
