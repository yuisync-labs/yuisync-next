# Certificação manual e operacional do YuiSync Next

Este roteiro valida a experiência que uma pessoa usa no navegador e confirma os efeitos persistidos no Cloudflare. Ele separa explicitamente dados descartáveis de staging das verificações somente leitura de produção.

## Regras de segurança

- Nunca criar, editar ou excluir dados comerciais de produção durante a certificação.
- Todo cenário que precisa gravar dados roda em staging com tenant e usuários prefixados por `e2e-`.
- A limpeza deve executar mesmo quando um cenário falha.
- A auditoria de produção aceita somente `SELECT`, `WITH` e `PRAGMA`.
- Não registrar senhas, cookies, tokens, nomes de clientes ou conteúdo comercial nos logs.
- Um teste pulado não conta como aprovado.

## Como disparar a certificação reproduzível

Crie um issue com o SHA exato da `main`:

```text
Release-SHA: <sha de 40 caracteres da main>
Authorization: AUTHORIZE_MANUAL_REGRESSION
```

Depois aplique o label `manual-regression-authorized`. O workflow `Manual operational certification` rejeita SHA antigo, usa dados isolados em staging e acessa produção somente para leitura.

## Checklist manual de interface

Registre para cada item: `PASS`, `FAIL` ou `BLOCKED`, navegador, viewport, horário e evidência.

### M01 — Superfície pública

- Abrir `/`, `/vendas` e `/entrar` em 390, 768, 1024 e 1440 px.
- Confirmar ausência de overflow horizontal, tela em branco, erro de console ou chamada `/api/*` com status 4xx/5xx inesperado.
- Confirmar que navegação, FAQ, planos, privacidade, termos e CTA respondem.

### M02 — Autenticação e papéis

- Entrar como administrador, gestor e usuário comum do tenant descartável.
- Recarregar o dashboard e confirmar que a sessão permanece válida.
- Confirmar que cada papel vê apenas módulos e ações autorizados.
- Sair e confirmar que uma rota autenticada volta para `/entrar`.

### M03 — Navegação interna e visual

- Abrir todas as abas autenticadas sem F5.
- Alternar tema claro/escuro e recolher/expandir o menu lateral.
- Confirmar contraste, foco visível, cabeçalho estável e ausência de reorganização abrupta.
- Repetir em desktop, tablet e celular.

### M04 — Agenda

- Criar um agendamento, editar apenas responsável, notas, data, hora, status, transporte, serviço e pet em operações separadas.
- Arrastar o card para um horário livre e confirmar que o horário exibido e o persistido são exatamente o destino escolhido.
- Recarregar a página e confirmar persistência.
- Abrir uma segunda aba e confirmar atualização sem F5.
- Concluir, reabrir e concluir novamente sem duplicar venda, pagamento, benefício ou comissão.

### M05 — Regras solicitadas pelo cliente

- `Tosa Tesoura`: concluir sem solicitar número de máquina.
- `Tosa com detalhe`: concluir sem solicitar número de máquina.
- `Tosa na máquina`, `Tosa total` ou `Tosa completa`: exigir número 4, 7 ou 10 antes da conclusão.
- `Corte de unha` avulso: contabilizar em **Outros serviços**, nunca como banho.
- `Banho com corte de unhas`: continuar contabilizado como banho.

### M06 — PDV, estoque e caixa

- Concluir checkout uma vez e repetir a mesma chave idempotente.
- Confirmar uma venda, um pagamento e um movimento de estoque.
- Confirmar que o estoque não baixa duas vezes.
- Enviar desconto acima da política e confirmar rejeição sem efeitos parciais.

### M07 — Usuários gerenciados

- Criar, listar e editar um usuário.
- Trocar senha e confirmar invalidação da senha antiga.
- Bloquear e confirmar revogação do acesso; desbloquear e confirmar restauração.
- Confirmar eventos correspondentes no audit log.

### M08 — Realtime

- Abrir WebSocket autenticado e tenant-scoped.
- Executar mutation no tenant descartável e confirmar invalidação uma única vez.
- Repetir após reconexão e após ocultar/mostrar a aba.
- Confirmar que a tela recarrega o estado autoritativo, sem usar o evento como fonte de verdade.

### M09 — D1 e readiness

- `/health` responde `ok` e `/ready` responde `ready` com schema v30.
- `PRAGMA quick_check` (suportado pelo D1 remoto) responde `ok`.
- `PRAGMA foreign_key_check` não retorna linhas.
- Tabelas críticas de operação e Better Auth existem.
- Não existem pets, agendamentos, itens, pagamentos ou memberships órfãos.
- Não restam tenants ou usuários `e2e-` após a limpeza.

### M10 — Produção somente leitura

- `https://yuisync.app/` responde HTTP 200.
- `/health` e `/ready` confirmam ambiente e canal `production`.
- Executar `npm run audit:cloudflare:readonly` pelo workflow protegido.
- Confirmar que nenhum passo de produção executou migration ou SQL mutável.

## Critério de aprovação

A certificação é `PASS` somente quando:

- nenhum cenário obrigatório foi pulado;
- staging, navegador, PDV, usuários, realtime e limpeza passaram;
- a auditoria read-only de produção passou;
- não há erro de console/API inesperado;
- toda falha possui evidência e bloqueia a aprovação.

Qualquer cenário não comprovado deve ser registrado como `GAP`, nunca presumido como aprovado.
