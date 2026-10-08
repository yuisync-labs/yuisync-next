# Luna nativa: atendimento interno em staging

O Worker autentica `POST /api/chat/respond` e `GET /api/chat/turns/:id?sessionId=...` com empresa/módulo explícitos. Somente staging com `LUNA_INTERNAL_CHAT_ENABLED=true` aceita o fluxo. Usar exclusivamente clientes fictícios e canal interno; o telefone pertence à conversa persistida, não ao payload do modelo. O ID da mensagem é obrigatório e estável.

`LunaNativeAgent` estende `Agent` do Cloudflare Agents SDK. O envio persiste a fila e retorna 202 antes de inferência. `schedule()` aciona `processPendingTurns`; o `alarm()` do SDK não é sobrescrito. Uma seção curta de armazenamento protege alterações da fila, sem segurar novos envios durante Groq. Mensagens adicionadas durante inferência são preservadas. Conflitos esperados saem fora de `blockConcurrencyWhile`, pois lançar dentro dele quebra o input gate.

A execução usa `GroqSdkProvider` → `runLunaTurn` → `ToolLoopAgent`, as mesmas ferramentas, verificação factual, rascunhos independentes e confirmação vinculada do playground/canal operacional. Não existe mais o loop alternativo de catálogo com respostas livres não verificadas. O export de consulta de catálogo permanece para seus consumidores existentes.

O diário D1 da migration aditiva 0045 persiste resultados e fingerprints por etapa. Não foi necessária nova migration. Identidade, vínculo, conversa, release e modelo são revalidados ao executar/retomar; revogação bloqueia antes de inferência. Payloads duráveis não contêm cookies ou secrets. Resultado externo desconhecido exige reconciliação, não replay. Turnos falhos não são silenciosamente pulados.

A UI consulta estados com recuo de 2 até 10 segundos, pausa quando oculta e restaura o último turno por GET após recarregar. Cancelar polling não cancela o atendimento persistido. Estados terminais interrompem consultas; nenhuma consulta de status reenvia mensagens. A tela exibe estado e diagnóstico e orienta não reenviar turnos ambíguos.

Provas locais incluem D1 real, provider simulado, quota, alarm do SDK, expulsão real do DO, deduplicação, isolamento, revogação e concorrência. São provas offline, não certificação de compreensão pelo Groq. A certificação real continua exigindo os 20 roteiros no navegador, cinco blocos, orçamento completo e revisão dos transcripts. Não ativar WhatsApp, alterar dados reais ou publicar em produção.
