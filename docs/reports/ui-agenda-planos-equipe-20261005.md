# Revisão manual de UI — 05/10/2026

Ambiente: `https://yuisync.app`, navegador lateral, sessão existente do tenant **YuiSync QA**, perfil Admin Pet. Revisão da UI publicada; nenhuma alteração de código, cadastro, agendamento, consumo, comissão ou valor financeiro foi aplicada.

**Resultado: revisão visual realizada, mas não aprovação completa dos percursos operacionais.** Há correções de UI necessárias e cenários sem dados suficientes nesta sessão.

## Verificações realizadas

| Área | Percurso | Resultado |
| --- | --- | --- |
| Agenda | Abrir página e alternar diária/semanal | Ambas carregaram |
| Agenda | Expandir/recolher intervalo 11h–13h | Controles e horários correspondentes apareceram |
| Agenda | Clicar em 08:20 | Formulário abriu com 08:20 |
| Agenda | Selecionar cliente/pet QA e buscar serviços | Busca, seleção, inclusão e remoção funcionaram sem salvar |
| Agenda | Selecionar tosa tesoura | Não pediu número de máquina no cadastro |
| Agenda | Selecionar tosa máquina | Total estabilizou em R$ 75; número não é pedido no cadastro. Código confirma solicitação na conclusão, não exercitada nesta rodada |
| Planos | Abrir Planos e assinantes / Pagamentos | Páginas e estados vazios carregaram |
| Planos | Novo pacote / adicionar serviço / fechar | Segunda linha de benefício apareceu; fechamento sem salvar funcionou |
| Planos | Vender pacote / fechar | Modal abriu e fechou pelos botões; continuar permaneceu desabilitado sem requisitos |
| Planos | Aviso financeiro claro e escuro | Texto do aviso legível em ambos, sem reproduzir o antigo texto amarelo quase invisível |
| Equipe | Comissões / Esteticistas / Motoboy | Abas, cards e tabelas carregaram |
| Equipe | Editar nome / cancelar | Campo e botões apareceram; cancelamento preservou o nome |
| Comissões | Período anterior / recalcular / voltar ao mês | Filtros operaram; setembro e outubro estavam sem serviços concluídos nesta sessão |
| Comissões | Conferir histórico individual / fechar | Modal e totais vazios apareceram |
| Geral | Claro/escuro e recolher/expandir sidebar | Estado final restaurado para escuro, sidebar expandida |
| Responsividade | Agenda, Planos e Equipe em 390 × 844 | Cabeçalhos e ações quebraram linhas; modal de agenda permitiu rolar até Descartar/Confirmar. Override removido no fim |
| Diagnóstico | Console do navegador durante a rodada | Nenhum warn/error capturado; isso não prova ausência de toda falha de API |

## Problemas confirmados

1. **Fonte dos botões diferente do conteúdo em Equipe & Comissões.** Estilo computado do `main`: `Nunito, sans-serif`; dos nove botões examinados: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Padronizar a tipografia dos controles sem alterar a fonte de títulos intencionalmente distinta.
2. **Ícones de calendário/horário com baixo contraste no escuro.** Reproduzido em datas de Comissões/Motoboy e data/horário da venda de pacote. `color-scheme` computado do input de data: `normal`. Aplicar esquema adequado aos controles nativos por tema; reconferir claro/escuro.
3. **Modal de venda de pacote sem isolamento de teclado.** Esc não fechou; Tab levou foco ao botão "Novo pacote" na página atrás do modal. Nenhum `role="dialog"` estava presente nessa tela. Corrigir foco inicial, trap/restauração de foco, semântica de diálogo e fechamento por Esc. Implementação ativa passa por `PlanosResponsivePage → PlanosCheckoutIntegratedPage → PlanosNativePage`.
4. **Campos sem nome acessível associado.** Período de Comissões e seletor de pacote apareceram como textbox/combobox sem nome na árvore; labels da implementação não têm associação `htmlFor/id`. Associar labels aos controles em `EquipePage.jsx` e `PlanosNativePage.jsx`.

Melhoria secundária: sem pacotes disponíveis, Vender pacote abre um seletor completamente vazio sem mensagem contextual. Explicar a ausência e orientar cadastro de pacote. O estado vazio do histórico de comissões também fica parcialmente fora da área visível devido à largura da tabela e exige rolagem horizontal.

## Não certificados nesta rodada

- Cores sólidas de banho/pacote/tosa, ações dos cards e fluidez do arraste: o período exibido do tenant QA estava sem agendamentos; não foram criados novos registros.
- Cards de planos ativos, uso editável, renovação e atribuição de responsável com comissão efetiva: nenhum pacote/assinante ou serviço concluído disponível nos períodos examinados.
- Impressão: clique em Imprimir resumo geral não produziu janela/aba/diálogo observável pelo lateral. Inconclusivo, não classificado como sucesso nem como falha confirmada do app.
- CSV: o clique não produziu evento de download observável em 10 segundos. Inconclusivo; validar arquivo no navegador convencional.
- Não foram acionados Zerar fechamento, confirmação de reserva, pagamentos, remoções ou gravações reais.

Para concluir a homologação visual dos cards e ações, usar uma sessão com registros fictícios existentes ou preparar fixtures isoladas no QA. Impressão/PDF/CSV precisam de comprovação do resultado final, não apenas do clique.

Evidência local protegida: `.migration/ui-review-20261005/comissoes-dark.jpg`. As capturas durante a revisão também foram exibidas no navegador lateral. Nenhum teste de carga, E2E automatizado ou varredura direta de D1 foi executado nesta rodada.

## Continuação autorizada com fixtures isoladas

Esta seção substitui as limitações da primeira rodada somente onde há prova abaixo. O usuário autorizou criar dados fictícios no QA e removê-los diretamente do D1; em seguida solicitou terminar a verificação antes de fazer uma única alteração de código. Nenhum arquivo do runtime foi modificado nem houve deploy nesta continuação.

### Percursos comprovados

- Agenda: criação de tosa na máquina por R$ 75; card azul sólido; arraste de 13:00 para 13:10 com confirmação; conclusão pediu número de máquina e persistiu o número 7 no D1.
- Comissões: atribuição posterior de Esteticista 1 retirou a pendência e atualizou receita para R$ 75 e comissão para R$ 7,50.
- Planos: cadastro de pacote fictício de R$ 40 com quatro cortes de unha; escolha de pet; criação pendente de pagamento; recebimento fictício em dinheiro; ativação criou quatro reservas sem consumo imediato.
- Consumo: tentativa de aumentar uso para 1 quando as quatro unidades estavam reservadas foi rejeitada com explicação. Conclusão do primeiro atendimento mudou o saldo para três reservas e um consumo, sem nova venda.
- Reagendamento: alteração da segunda reserva para hoje às 16:00 persistiu e apareceu na Agenda.
- Cancelamento do atendimento: retirou uma reserva e liberou uma unidade. Edição administrativa de uso total para 2 foi aceita dentro da capacidade, preservando um consumo por atendimento e um ajuste separado no banco.
- Cancelamento da assinatura: status cancelado persistiu e ações de consumo/cancelamento ficaram desabilitadas. Duas reservas futuras permaneceram no ledger; a política de cancelamento da assinatura precisa ser revisada, não certificada como liberação integral.
- Diagnóstico: nenhum erro/warn no console capturado nesta continuação. As consultas diretas ficaram restritas ao tenant e IDs de QA, além de leitura do schema; não representam a métrica total das chamadas da UI.

### Novos achados para o lote único

1. **Bloqueador funcional de comissão de pacote novo.** O catálogo do corte de unha tinha comissão de 500 basis points (5%), mas o atendimento automaticamente criado pelo pacote tinha `appointment_services.commission_basis_points = NULL`. Após atribuir Esteticista 2, a UI corretamente separou o item como regra histórica ausente e não o incluiu no pagamento. A criação automática em `apps/edge-api/src/compatSubscriptionRpc.ts`, INSERT de `appointment_services`, grava explicitamente NULL para essa coluna. Corrigir a captura da regra vigente no momento da criação e a base histórica do pacote; não preencher históricos reais retroativamente sem política explícita. A unha não aumentou o contador de banhos, mas sua contabilização final em Outros não ficou certificada devido a esse bloqueador.
2. **Navegação indevida ao salvar datas de pacote já ativo.** Salvar datas reagendou corretamente, porém levou à aba Pagamentos vazia. `PlanosCheckoutIntegratedPage.jsx` trata todo `PACKAGE_SCHEDULE_SAVED_EVENT` como mudança para pagamentos. Manter o usuário em Planos para ciclo ativo; abrir pagamento somente para ciclo pendente.
3. **Cancelamento de assinatura e reservas futuras não reconciliados.** Assinatura cancelada ainda mostrava duas unidades reservadas e agendamentos futuros persistiam. Revisar o contrato de cancelamento antes de alterar dados: preservar concluídos/ajustes, definir explicitamente o destino das reservas abertas e comunicar essa consequência no modal.

Continuam no lote os quatro problemas visuais/acessíveis da primeira rodada: fonte dos controles, `color-scheme` de datas/horários, foco/Esc/semântica dos modais e associação dos labels.

### Limpeza e limites da certificação

Removidos apenas os registros criados nesta rodada: cinco agendamentos e seus cinco itens, quatro alocações, um registro de idempotência, um pacote, uma assinatura, uma venda e um pagamento. Nenhum cliente, pet, serviço, profissional ou registro do Quatro Patas foi excluído. As consultas posteriores por escopo/IDs retornaram zero resíduos em quinze famílias de tabelas. Backup bruto local ignorado: `.migration/ui-review-20261005/fixture-backup.json`.

Evidência do estado cancelado: `.migration/ui-review-20261005/planos-cancelado.jpg`.

Não declarar homologação completa: impressão/PDF/CSV continuam inconclusivos no lateral; a conclusão de tesoura/detalhe, card verde de banho avulso, renovação integral de ciclo e contabilização final da unha com snapshot correto ainda precisam de prova específica. Zerar fechamento não foi acionado para preservar a configuração preexistente do QA. Nenhum teste de carga foi feito.

## Lote de correção local e conferência do Quatro Patas

- Branch: `codex/petshop-ui-package-regressions`. Este lote não foi publicado nem mesclado.
- Corrigidos fonte dos controles e esquema nativo claro/escuro, labels, semântica dos seis modais de planos, Esc, contenção e restauração de foco. Seletor sem pacotes agora explica o estado vazio.
- Salvar datas de ciclo ativo permanece em Planos; somente ciclo pendente leva a Pagamentos. Incluído teste de navegação.
- Novos atendimentos automáticos de pacote capturam percentual e base monetária na criação. O rateio puro foi extraído para `shared/packageCommissionAllocation.js`, compartilhado com o Worker, sem importar a compatibilidade do frontend para o backend. A UI prioriza a base capturada inclusive quando zero. Não houve preenchimento retroativo de snapshots.
- Cancelamento nativo bloqueia atendimentos em andamento, cancela reservas não iniciadas e libera o ledger pelo ciclo existente. Preserva concluídos, consumos e pagamentos; não gera estorno. Atualização PATCH com status cancelado usa o mesmo caminho. Teste D1 local confirma repetição sem duplicação, bloqueio, liberação e preservação financeira.
- Conferência REST somente leitura: 190 serviços no Supabase e 190 no D1; nenhum percentual divergente. A única regra adicional também coincide após normalização dos campos. Consulta D1 do catálogo/regras leu 192 linhas; configuração dos responsáveis leu uma linha. Esses números não incluem leituras da UI.
- Sessão global no navegador lateral confirmou acesso ao Quatro Patas e abertura do histórico de comissão. As chaves operacionais coincidem, mas os nomes não: fonte tem Thaiane/Estefanea; configuração D1 mantém Esteticista 1/2. A projeção de migração foi corrigida para preservar responsáveis, inclusive quando só estão em templates e sem horários configurados. **A reparação da configuração real ainda não foi aplicada**; não substituir a extensão inteira nem sobrescrever configurações mais recentes para corrigir nomes.
- O histórico real ainda contém bases de pacote reconstruídas pelo plano atual ou referência de catálogo. Percentuais do catálogo coincidirem não certifica por si só o total integral do fechamento legado. Não alterar valores reais com regras atuais.
- Evidências brutas da auditoria permanecem ignoradas em `.migration/commission-source-audit-20261005.json`; nenhuma credencial foi versionada.

Validação local: typecheck frontend/Worker, build, quatro arquivos de regressão frontend (11 testes), integração local D1 (1 teste composto). Projeção de migração executada separadamente, porque o include padrão do Vitest frontend não cobre `test/*.mjs`. Warning de chunk grande da esfera no build permanece preexistente. Validação em produção das correções continua pendente de publicação e rodada manual final.

### Reparação autorizada e bloqueio de release

- Nomes reparados diretamente no D1 em 05/10, com backup ignorado, guarda por versão/timestamp e comparação do JSON antes/depois. Uma linha de configuração escrita; apenas os nomes nas duas representações foram alterados. Chaves `esteticista-1`/`esteticista-2` e todos os vínculos financeiros preservados. Isso substitui a pendência de nomes acima.
- A main remota ainda coincide com a base `809b196d3762861e7eef34073e44b7fb5f7be5ef`, sem PRs abertas antes deste lote.
- Quality recente da main falha no audit de segurança, não em SHA ou credencial. Novos advisories de Axios, Undici e cadeia Tailwind 3 foram confirmados pelo npm. Atualizados Axios para 1.20.0 e override Undici para 7.29.1; algumas cópias transitivas do toolchain Cloudflare ainda exigem tratamento específico.
- `braces` 3.0.3 e `micromatch` 4.0.8, ambos últimas versões consultadas, continuam nas faixas vulneráveis. O npm aponta Tailwind 4.3.3 como mudança maior para retirar a cadeia. Não alterar o motor CSS inteiro nesta correção pontual sem revisão visual específica, nem liberar através de exceção nova de segurança.
- Publicação continua bloqueada por esse audit. Nenhum deploy deste lote foi feito e nenhum histórico de comissão foi recalculado.
