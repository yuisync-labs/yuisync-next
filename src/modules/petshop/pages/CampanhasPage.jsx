import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  FileText,
  Megaphone,
  MessageSquare,
  Plus,
  Save,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { Card, MetricCard, Panel, StatusBadge } from '../../../components/ui'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import {
  CAMPAIGN_SEGMENTS,
  audienceDescription,
  campaignStorageKey,
  normalizeCampaignDraft,
  previewCampaignMessage,
  readCampaignDrafts,
  unknownCampaignVariables,
} from '../lib/campaignDrafts'

const STEPS = [
  { label: 'Público', icon: Users },
  { label: 'Mensagem e template', icon: MessageSquare },
  { label: 'Orçamento e envio', icon: Wallet },
  { label: 'Acompanhamento', icon: Clock },
]

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-2">
      <span className="inp-label">{label}</span>
      {children}
      {hint && (
        <span className="block text-xs leading-5 text-muted">{hint}</span>
      )}
    </label>
  )
}

export default function CampanhasPage() {
  const { activeTenantId, session, storeSettings } = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const storageKey = campaignStorageKey(
    session?.user?.id,
    activeTenantId,
    activeModuleId || 'petshop',
  )
  // A new scope remounts the editor before any new draft can be written.
  return storageKey ? (
    <CampaignWorkspace
      key={storageKey}
      storageKey={storageKey}
      storeName={storeSettings?.store_name}
    />
  ) : (
    <div className="page">
      <p className="text-muted">
        Selecione uma loja para preparar suas campanhas.
      </p>
    </div>
  )
}

function CampaignWorkspace({ storageKey, storeName }) {
  const [initial] = useState(() => {
    try {
      return { drafts: readCampaignDrafts(localStorage, storageKey), error: '' }
    } catch {
      return {
        drafts: [],
        error:
          'Não foi possível recuperar os rascunhos deste navegador. O conteúdo salvo não foi substituído.',
      }
    }
  })
  const [drafts, setDrafts] = useState(initial.drafts)
  const [draft, setDraft] = useState(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState(initial.error)
  const [saveState, setSaveState] = useState('')
  const writeBlocked = useRef(Boolean(initial.error))
  const draftsRef = useRef(initial.drafts)
  const draftRef = useRef(null)

  function persist(value) {
    if (!value || writeBlocked.current) return null
    const saved = normalizeCampaignDraft({ ...value, updatedAt: Date.now() })
    const next = [
      saved,
      ...draftsRef.current.filter(({ id }) => id !== saved.id),
    ].slice(0, 50)
    localStorage.setItem(storageKey, JSON.stringify(next))
    draftsRef.current = next
    return next
  }

  function saveDraft(value) {
    try {
      const next = persist(value)
      if (!next) return false
      setDrafts(next)
      setSaveState('Salvo neste navegador')
      setError('')
      return true
    } catch {
      setError(
        'Não foi possível salvar neste navegador. Mantenha a tela aberta para preservar suas alterações.',
      )
      setSaveState('Alterações não salvas')
      return false
    }
  }

  useEffect(() => {
    if (!draft) return undefined
    setSaveState('Salvando…')
    const timer = setTimeout(() => saveDraft(draft), 500)
    return () => clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    function persistOnExit() {
      try {
        persist(draftRef.current)
      } catch {
        /* Retain edits in memory if storage fails. */
      }
    }
    window.addEventListener('pagehide', persistOnExit)
    return () => {
      window.removeEventListener('pagehide', persistOnExit)
      persistOnExit()
    }
  }, [storageKey])

  function update(patch) {
    const next = { ...draftRef.current, ...patch }
    if (Object.hasOwn(patch, 'message')) next.confirmedMessage = ''
    draftRef.current = next
    setDraft(next)
  }

  function openDraft(value) {
    draftRef.current = value
    setDraft(value)
    setStep(0)
    setSaveState('')
  }
  function createDraft() {
    openDraft(normalizeCampaignDraft({ id: crypto.randomUUID() }))
  }
  function backToList() {
    if (!saveDraft(draftRef.current)) return
    draftRef.current = null
    setDraft(null)
  }

  const hasAbsence =
    draft &&
    ['inactive', 'recurring_inactive', 'first_visit'].includes(draft.segment)
  const hasRecurrence =
    draft && ['recurring', 'recurring_inactive'].includes(draft.segment)
  const invalidVariables = draft ? unknownCampaignVariables(draft.message) : []
  const confirmed = Boolean(
    draft?.message.trim() && draft.confirmedMessage === draft.message,
  )

  function numberField(label, key, max) {
    return (
      <Field label={label}>
        <input
          type="number"
          min="1"
          max={max}
          className="inp"
          value={draft[key]}
          onChange={(event) => update({ [key]: event.target.value })}
          onBlur={() => update({ [key]: normalizeCampaignDraft(draft)[key] })}
        />
      </Field>
    )
  }

  return (
    <div className="page space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Megaphone size={22} /> Campanhas
          </h1>
          <p className="page-sub">
            Transforme sua carteira de clientes em novas visitas pelo WhatsApp.
          </p>
        </div>
        {!draft && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={writeBlocked.current || drafts.length >= 50}
            onClick={createDraft}
          >
            <Plus size={16} /> Nova campanha
          </button>
        )}
      </header>
      <Card tone="subtle" className="px-5 py-4 flex items-start gap-3">
        <FileText size={18} className="text-muted shrink-0 mt-1" />
        <div>
          <p className="text-sm font-semibold text-text">
            Prepare sua próxima campanha
          </p>
          <p className="text-sm text-muted mt-1">
            Defina o público, revise a mensagem e salve rascunhos neste
            navegador. Aprovação pela Meta e disparos serão habilitados em uma
            próxima etapa.
          </p>
        </div>
      </Card>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      {drafts.length >= 50 && (
        <p className="text-sm text-muted">
          Limite de 50 rascunhos neste navegador atingido. Continue uma campanha
          existente.
        </p>
      )}

      {!draft ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              label="Rascunhos neste navegador"
              value={drafts.length}
              icon={FileText}
            />
            <MetricCard
              label="Aprovação na Meta"
              value="—"
              description="Disponível após conectar o fluxo de aprovação."
              icon={ShieldCheck}
            />
            <MetricCard
              label="Mensagens entregues"
              value="—"
              description="Os resultados aparecerão após o primeiro disparo."
              icon={MessageSquare}
            />
          </div>
          <Panel
            title="Suas campanhas"
            description="Rascunhos desta loja e deste usuário. Não são sincronizados com outros dispositivos."
          >
            {drafts.length ? (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th>Público</th>
                      <th>Status</th>
                      <th>Última alteração</th>
                      <th>
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((item) => (
                      <tr key={item.id}>
                        <td className="font-semibold">
                          {item.name || 'Campanha sem título'}
                        </td>
                        <td>{audienceDescription(item)}</td>
                        <td>
                          <StatusBadge>Rascunho</StatusBadge>
                        </td>
                        <td>
                          {new Date(item.updatedAt).toLocaleString('pt-BR')}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            aria-label={`Continuar ${item.name || 'campanha sem título'}`}
                            onClick={() => openDraft(item)}
                          >
                            Continuar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 space-y-3">
                <Users size={32} className="mx-auto text-muted" />
                <h3 className="font-semibold text-text">
                  Uma boa campanha começa pelo público certo
                </h3>
                <p className="text-sm text-muted max-w-md mx-auto">
                  Recupere clientes sem retorno, converse com os recorrentes ou
                  prepare uma mensagem para toda a carteira elegível.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={writeBlocked.current}
                  onClick={createDraft}
                >
                  Criar primeira campanha
                </button>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={backToList}
            >
              <ArrowLeft size={16} /> Todas as campanhas
            </button>
            <div className="flex items-center gap-3">
              <span role="status" className="text-xs text-muted">
                {saveState}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => saveDraft(draft)}
              >
                <Save size={15} /> Salvar rascunho
              </button>
            </div>
          </div>
          <Field label="Nome da campanha">
            <input
              className="inp"
              value={draft.name}
              maxLength={100}
              placeholder="Ex.: Volta para o banho · novembro"
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <nav
            aria-label="Etapas da campanha"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2"
          >
            {STEPS.map(({ label, icon: Icon }, index) => (
              <button
                type="button"
                key={label}
                aria-current={step === index ? 'step' : undefined}
                onClick={() => setStep(index)}
                className={`btn justify-start ${step === index ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Icon size={16} />
                <span>
                  {index + 1}. {label}
                </span>
              </button>
            ))}
          </nav>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-5">
              {step === 0 && (
                <>
                  <Panel
                    title="Quem você quer alcançar?"
                    description="Escolha um segmento e ajuste as regras da campanha."
                  >
                    <fieldset>
                      <legend className="sr-only">Segmento do público</legend>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {CAMPAIGN_SEGMENTS.map((segment) => (
                          <Card
                            key={segment.id}
                            as="label"
                            interactive
                            className={`p-4 flex items-start gap-3 cursor-pointer ${draft.segment === segment.id ? 'ring-2 ring-[var(--primary)]' : ''}`}
                          >
                            <input
                              type="radio"
                              name="campaign-segment"
                              value={segment.id}
                              checked={draft.segment === segment.id}
                              onChange={() => update({ segment: segment.id })}
                              className="mt-1"
                            />
                            <span>
                              <span className="block text-sm font-semibold text-text">
                                {segment.label}
                              </span>
                              <span className="block text-xs leading-5 text-muted mt-1">
                                {segment.description}
                              </span>
                            </span>
                          </Card>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid sm:grid-cols-2 gap-4 mt-5">
                      {hasAbsence &&
                        numberField(
                          'Sem retornar há mais de (dias)',
                          'inactiveDays',
                          3650,
                        )}
                      {hasRecurrence && (
                        <>
                          {numberField(
                            'Mínimo de atendimentos',
                            'minVisits',
                            1000,
                          )}
                          {numberField(
                            'Nos últimos (meses)',
                            'periodMonths',
                            120,
                          )}
                        </>
                      )}
                    </div>
                    <p className="text-xs leading-5 text-muted mt-4">
                      A regra considera atendimentos concluídos. Cancelamentos e
                      agendamentos futuros não representam visitas. Clientes sem
                      histórico ficam no segmento “Nunca atendidos”.
                    </p>
                  </Panel>
                  <Panel title="Preferências de contato" icon={ShieldCheck}>
                    <div className="space-y-4 text-sm">
                      <label className="flex gap-3 items-center">
                        <input
                          type="checkbox"
                          checked={draft.excludeFutureBookings}
                          onChange={(event) =>
                            update({
                              excludeFutureBookings: event.target.checked,
                            })
                          }
                        />{' '}
                        Excluir clientes que já têm agendamento futuro
                      </label>
                      {numberField(
                        'Intervalo mínimo entre campanhas (dias)',
                        'cooldownDays',
                        365,
                      )}
                      <p className="text-muted">
                        No envio, serão exigidos contatos autorizados, sem
                        descadastro e sem duplicidade por telefone, mesmo quando
                        o tutor tiver vários pets.
                      </p>
                    </div>
                  </Panel>
                  <Panel
                    title="Prévia do público"
                    description="A contagem e a lista de destinatários dependem da integração dos filtros com a carteira."
                  >
                    <p className="text-sm text-muted">
                      Nenhum destinatário foi calculado ou selecionado para
                      envio.
                    </p>
                  </Panel>
                </>
              )}
              {step === 1 && (
                <>
                  <Panel
                    title="O que você quer comunicar?"
                    description="Descreva a ideia, a oferta e a validade. A revisão por IA será conectada depois."
                  >
                    <Field label="Ideia da mensagem">
                      <textarea
                        rows={4}
                        className="inp resize-y"
                        maxLength={2000}
                        value={draft.brief}
                        placeholder="Ex.: Convidar clientes que não voltam há 60 dias. Oferecer 10% no banho até sexta."
                        onChange={(event) =>
                          update({ brief: event.target.value })
                        }
                      />
                    </Field>
                    <button
                      type="button"
                      disabled
                      className="btn btn-secondary mt-4"
                      aria-describedby="campaign-ai-hint"
                    >
                      Melhorar texto com IA
                    </button>
                    <p
                      id="campaign-ai-hint"
                      className="text-xs text-muted mt-2"
                    >
                      Disponível na próxima etapa. Por enquanto, escreva e
                      revise a mensagem abaixo.
                    </p>
                  </Panel>
                  <Panel
                    title="Mensagem do template"
                    action={
                      <StatusBadge>Marketing · Português (BR)</StatusBadge>
                    }
                  >
                    <Field
                      label="Texto da mensagem"
                      hint={`${draft.message.length}/1.024 caracteres`}
                    >
                      <textarea
                        rows={7}
                        className="inp resize-y"
                        maxLength={1024}
                        value={draft.message}
                        placeholder="Olá, {{nome_tutor}}! Sentimos falta de vocês na {{nome_loja}}. Vamos marcar o próximo banho?"
                        onChange={(event) =>
                          update({ message: event.target.value })
                        }
                      />
                    </Field>
                    <p className="text-xs text-muted mt-3">
                      Inserir personalização:
                    </p>
                    <div className="flex gap-2 flex-wrap mt-2">
                      {['nome_tutor', 'nome_pet', 'nome_loja'].map(
                        (variable) => (
                          <button
                            type="button"
                            key={variable}
                            className="btn btn-secondary btn-sm"
                            disabled={
                              draft.message.length + variable.length + 5 > 1024
                            }
                            onClick={() =>
                              update({
                                message: `${draft.message}${draft.message ? ' ' : ''}{{${variable}}}`,
                              })
                            }
                          >{`{{${variable}}}`}</button>
                        ),
                      )}
                    </div>
                    {invalidVariables.length > 0 && (
                      <p role="alert" className="text-sm text-red-500 mt-3">
                        Use apenas as personalizações disponíveis:{' '}
                        {invalidVariables.join(', ')}.
                      </p>
                    )}
                    <div className="mt-5">
                      <Field label="Ação principal">
                        <select
                          className="inp"
                          value={draft.button}
                          onChange={(event) =>
                            update({ button: event.target.value })
                          }
                        >
                          <option value="reply">Responder à mensagem</option>
                          <option value="booking">Agendar atendimento</option>
                        </select>
                      </Field>
                    </div>
                    <p className="text-xs text-muted mt-3">
                      A opção de parar de receber será incluída no template ao
                      conectar o envio.
                    </p>
                    <label className="flex items-start gap-3 text-sm text-text mt-5">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={confirmed}
                        disabled={
                          !draft.message.trim() || invalidVariables.length > 0
                        }
                        onChange={(event) =>
                          update({
                            confirmedMessage: event.target.checked
                              ? draft.message
                              : '',
                          })
                        }
                      />
                      <span>
                        Revisei o texto, a oferta e a validade desta versão.
                        Qualquer alteração no texto exigirá nova confirmação.
                      </span>
                    </label>
                  </Panel>
                  <Panel
                    title="Aprovação na Meta"
                    description="A confirmação do texto salva sua revisão. Ela ainda não envia o template à Meta."
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <StatusBadge>
                        {confirmed
                          ? 'Texto revisado'
                          : 'Aguardando sua revisão'}
                      </StatusBadge>
                      <StatusBadge>Não submetido</StatusBadge>
                    </div>
                    <button
                      type="button"
                      disabled
                      className="btn btn-secondary"
                      aria-describedby="campaign-meta-hint"
                    >
                      Enviar template para aprovação
                    </button>
                    <p
                      id="campaign-meta-hint"
                      className="text-xs text-muted mt-2"
                    >
                      A integração de aprovação será habilitada depois. Status e
                      motivos de rejeição aparecerão aqui, sem sair da campanha.
                    </p>
                  </Panel>
                </>
              )}
              {step === 2 && (
                <>
                  <Panel
                    title="Orçamento da campanha"
                    description="Defina quanto pretende investir em mensagens."
                  >
                    <Field
                      label="Limite planejado (R$)"
                      hint="Esse valor é uma preferência do rascunho. Não representa saldo ou cobrança."
                    >
                      <input
                        type="number"
                        className="inp"
                        min="0"
                        max="9999999"
                        step="0.01"
                        value={draft.budget}
                        placeholder="Ex.: 200,00"
                        onChange={(event) =>
                          update({ budget: event.target.value })
                        }
                      />
                    </Field>
                    <dl className="mt-5 space-y-3 text-sm">
                      {[
                        ['Destinatários elegíveis', 'A calcular'],
                        ['Tarifa de marketing', 'A confirmar'],
                        ['Custo estimado da Meta', 'Indisponível'],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-4">
                          <dt className="text-muted">{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-muted mt-4 leading-5">
                      A estimativa dependerá do público elegível, da moeda de
                      faturamento e da tabela vigente da Meta. Custos do YuiSync
                      serão apresentados separadamente.
                    </p>
                  </Panel>
                  <Panel title="Quando pretende enviar?">
                    <Field label="Preferência de envio">
                      <select
                        className="inp"
                        value={draft.sendMode}
                        onChange={(event) =>
                          update({ sendMode: event.target.value })
                        }
                      >
                        <option value="manual">
                          Enviar após revisão final
                        </option>
                        <option value="scheduled">
                          Escolher data e horário
                        </option>
                      </select>
                    </Field>
                    {draft.sendMode === 'scheduled' && (
                      <div className="mt-4">
                        <Field
                          label="Data e horário desejados"
                          hint={`Horário deste navegador: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. O fuso da loja será validado antes de habilitar o agendamento.`}
                        >
                          <input
                            type="datetime-local"
                            className="inp"
                            value={draft.scheduledAt}
                            onChange={(event) =>
                              update({ scheduledAt: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                    )}
                    <p className="text-sm text-muted mt-4">
                      Salvar essa preferência não agenda um disparo. O envio
                      dependerá de template aprovado, público validado e
                      confirmação do orçamento.
                    </p>
                    <button
                      type="button"
                      disabled
                      className="btn btn-secondary mt-4"
                    >
                      {draft.sendMode === 'scheduled'
                        ? 'Agendar campanha'
                        : 'Enviar campanha'}
                    </button>
                  </Panel>
                </>
              )}
              {step === 3 && (
                <>
                  <Panel
                    title="Próximos passos da campanha"
                    description="O progresso real será atualizado após a integração com a Meta."
                  >
                    <ol className="space-y-5">
                      {[
                        ['Definir público', audienceDescription(draft)],
                        [
                          'Revisar mensagem',
                          confirmed
                            ? 'Você confirmou esta versão do texto.'
                            : 'Escreva a mensagem e confirme a revisão.',
                        ],
                        [
                          'Aprovar template na Meta',
                          'Template ainda não submetido.',
                        ],
                        [
                          'Revisar orçamento e confirmar envio',
                          'Nenhum envio realizado ou agendado.',
                        ],
                      ].map(([title, description], index) => (
                        <li key={title} className="flex gap-3">
                          <span className="text-muted font-semibold">
                            {index + 1}.
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-text">
                              {title}
                            </p>
                            <p className="text-xs text-muted mt-1">
                              {description}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {[
                      'Mensagens entregues',
                      'Respostas',
                      'Descadastros',
                      'Custo da Meta',
                    ].map((label) => (
                      <MetricCard
                        key={label}
                        label={label}
                        value="—"
                        description="Disponível após o envio."
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            <aside className="space-y-5">
              <Panel title="Resumo da campanha">
                <div className="space-y-4 text-sm">
                  <StatusBadge>Rascunho</StatusBadge>
                  <p className="font-semibold text-text break-words">
                    {draft.name || 'Campanha sem título'}
                  </p>
                  <div>
                    <p className="text-xs text-muted mb-1">Público</p>
                    <p>{audienceDescription(draft)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">Preferências</p>
                    <p>
                      {draft.excludeFutureBookings
                        ? 'Sem agendamento futuro. '
                        : ''}
                      Intervalo de {draft.cooldownDays} dias entre campanhas.
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    A elegibilidade dos contatos será verificada antes do envio.
                  </p>
                </div>
              </Panel>
              <Panel
                title="Prévia no WhatsApp"
                description="Exemplo ilustrativo com nomes fictícios."
              >
                <Card tone="subtle" className="p-4">
                  <p className="text-xs font-semibold text-muted mb-3">
                    {storeName || 'Sua loja'}
                  </p>
                  <p className="text-sm whitespace-pre-wrap break-words leading-6">
                    {draft.message.trim()
                      ? previewCampaignMessage(draft.message, storeName)
                      : 'Sua mensagem aparecerá aqui conforme você escrever.'}
                  </p>
                  <div className="border-t border-[var(--border)] mt-4 pt-3 text-center text-sm text-muted">
                    {draft.button === 'booking'
                      ? 'Agendar atendimento'
                      : 'Quero conversar'}
                  </div>
                  <div className="text-center text-xs text-muted mt-3">
                    Parar de receber
                  </div>
                </Card>
              </Panel>
            </aside>
          </div>
          <footer className="flex justify-between gap-3 border-t border-[var(--border)] pt-5">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Anterior
            </button>
            {step < 3 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep(step + 1)}
              >
                Continuar <ArrowRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={backToList}
              >
                <Save size={16} /> Salvar e voltar
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
