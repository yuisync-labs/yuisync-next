import { readFile, writeFile } from 'node:fs/promises'

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8')
  for (const { from, to, label } of replacements) {
    const count = text.split(from).length - 1
    if (count !== 1) throw new Error(`${path}: ${label} expected once, found ${count}`)
    text = text.replace(from, to)
  }
  await writeFile(path, text, 'utf8')
}

await patch('apps/edge-api/src/petshopPlansApi.ts', [
  {
    label: 'benefit ledger import',
    from: "import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'\n",
    to: "import { getBetterAuthSession, type BetterAuthRuntimeBindings } from './auth/betterAuthRuntime'\nimport { projectBenefitLedger } from './subscriptionBenefitLedger'\n",
  },
  {
    label: 'benefit ledger endpoint',
    from: "async function listSubscriptionAppointments(request: Request, bindings: Bindings, subscriptionId: string): Promise<Response> {",
    to: `async function listSubscriptionBenefitLedger(request: Request, bindings: Bindings, subscriptionId: string): Promise<Response> {
  const resolved = await resolveScope(request, bindings)
  if (resolved.error) return resolved.error
  const scope = resolved.scope!
  const subscription = await bindings.DB!.prepare(\`
    SELECT subscription.id,subscription.benefit_ledger_base_used_json,plan.services_json
    FROM client_subscriptions subscription
    JOIN subscription_plans plan
      ON plan.tenant_id=subscription.tenant_id AND plan.module_id=subscription.module_id AND plan.id=subscription.plan_id
    WHERE subscription.tenant_id=?1 AND subscription.module_id=?2 AND subscription.id=?3
    LIMIT 1
  \`).bind(scope.tenantId, scope.moduleId, subscriptionId).first<{
    id: string; benefit_ledger_base_used_json: string; services_json: string
  }>()
  if (!subscription) return json({ code: 'SUBSCRIPTION_NOT_FOUND' }, 404)

  const allocations = await bindings.DB!.prepare(\`
    SELECT allocation.id,allocation.benefit_key,allocation.service_code,allocation.state,
      allocation.appointment_id,allocation.reserved_at_ms,allocation.consumed_at_ms,
      allocation.released_at_ms,allocation.updated_at_ms,
      appointment.status AS appointment_status,appointment.scheduled_at_ms,
      service.service_name
    FROM subscription_benefit_allocations allocation
    LEFT JOIN appointments appointment
      ON appointment.tenant_id=allocation.tenant_id
      AND appointment.module_id=allocation.module_id
      AND appointment.id=allocation.appointment_id
    LEFT JOIN appointment_services service
      ON service.tenant_id=allocation.tenant_id
      AND service.module_id=allocation.module_id
      AND service.appointment_id=allocation.appointment_id
      AND service.position=allocation.appointment_service_position
    WHERE allocation.tenant_id=?1 AND allocation.module_id=?2 AND allocation.subscription_id=?3
    ORDER BY COALESCE(allocation.consumed_at_ms,allocation.released_at_ms,allocation.reserved_at_ms,allocation.updated_at_ms) DESC,
      allocation.id DESC
  \`).bind(scope.tenantId, scope.moduleId, subscriptionId).all<any>()

  return json({
    benefits: projectBenefitLedger({
      services: parseArray(subscription.services_json),
      baseUsage: numericObject(subscription.benefit_ledger_base_used_json),
      allocations: allocations.results,
    }),
  })
}

async function listSubscriptionAppointments(request: Request, bindings: Bindings, subscriptionId: string): Promise<Response> {`,
  },
  {
    label: 'benefit ledger route',
    from: "  const appointmentsMatch = /^\\/api\\/petshop\\/subscriptions\\/([^/]+)\\/appointments$/.exec(pathname)\n",
    to: `  const benefitsMatch = /^\\/api\\/petshop\\/subscriptions\\/([^/]+)\\/benefits$/.exec(pathname)
  if (benefitsMatch) {
    const id = decodeURIComponent(benefitsMatch[1])
    if (!ID.test(id)) return json({ code: 'INVALID_SUBSCRIPTION_ID' }, 400)
    if (request.method === 'GET') return listSubscriptionBenefitLedger(request, bindings, id)
    return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' })
  }
  const appointmentsMatch = /^\\/api\\/petshop\\/subscriptions\\/([^/]+)\\/appointments$/.exec(pathname)
`,
  },
])

await patch('src/modules/petshop/lib/packageCommissionOperations.js', [
  {
    label: 'package base provenance',
    from: `  const enrichedItems = sourceItems.map((item) => ({
    ...item,
    package_covered: true,
    package_plan_name: allocation.plan_name,
    package_unit_price: allocationValueForItem(allocation, item),
    package_service_pool: allocation.service_pool,
    package_transport_total: allocation.transport_total,
  }))`,
    to: `  const enrichedItems = sourceItems.map((item) => {
    const recordedPackageBase = Number(item?.package_unit_price)
    const hasRecordedPackageBase = item?.package_unit_price !== null
      && item?.package_unit_price !== undefined
      && item?.package_unit_price !== ''
      && Number.isFinite(recordedPackageBase)
      && recordedPackageBase >= 0
    return {
      ...item,
      package_covered: true,
      package_plan_name: allocation.plan_name,
      package_unit_price: hasRecordedPackageBase ? recordedPackageBase : allocationValueForItem(allocation, item),
      package_base_source: hasRecordedPackageBase ? 'appointment_snapshot' : 'current_plan_allocation',
      package_service_pool: allocation.service_pool,
      package_transport_total: allocation.transport_total,
    }
  })`,
  },
  {
    label: 'package companion provenance',
    from: `      package_plan_name: allocation.plan_name,
      package_unit_price: entry.package_unit_value,
      package_service_pool: allocation.service_pool,`,
    to: `      package_plan_name: allocation.plan_name,
      package_unit_price: entry.package_unit_value,
      package_base_source: 'current_plan_allocation',
      package_service_pool: allocation.service_pool,`,
  },
  {
    label: 'package appointment provenance',
    from: `      package_commission: true,
      package_plan_name: allocation.plan_name,
      package_service_pool: allocation.service_pool,`,
    to: `      package_commission: true,
      package_plan_name: allocation.plan_name,
      package_commission_base_source: enrichedItems.some((item) => item.package_base_source === 'appointment_snapshot')
        ? 'mixed_or_snapshot'
        : 'current_plan_allocation',
      package_service_pool: allocation.service_pool,`,
  },
])

await patch('src/modules/petshop/lib/teamCommissionSummary.js', [
  {
    label: 'commission base provenance selection',
    from: `    const baseSource = packageCovered
      ? packageRevenue > 0 ? 'package_allocation' : 'catalog_reference'
      : 'appointment_snapshot'`,
    to: `    const packageBaseSource = String(item.package_base_source || appointment.package_commission_base_source || '')
    const baseSource = packageCovered
      ? packageBaseSource === 'current_plan_allocation'
        ? 'package_current_plan_allocation'
        : packageBaseSource === 'appointment_snapshot'
          ? 'package_appointment_snapshot'
          : packageRevenue > 0 ? 'package_allocation' : 'catalog_reference'
      : 'appointment_snapshot'`,
  },
  {
    label: 'commission base label helper',
    from: `export function buildCommissionRows(history = [], configuredStaff = []) {`,
    to: `export function commissionBaseSourceLabel(source = '') {
  const normalized = String(source || '')
  if (normalized === 'appointment_snapshot') return 'Valor gravado no atendimento'
  if (normalized === 'package_appointment_snapshot') return 'Base de pacote gravada no atendimento'
  if (normalized === 'package_current_plan_allocation') return 'Base reconstruída pelo plano atual'
  if (normalized === 'package_allocation') return 'Alocação do pacote'
  if (normalized === 'catalog_reference') return 'Referência de catálogo'
  return 'Base sem origem identificada'
}

export function buildCommissionRows(history = [], configuredStaff = []) {`,
  },
])

await patch('src/modules/petshop/pages/PlanosNativePage.jsx', [
  {
    label: 'Card import',
    from: "import { useClients } from '../../../shared/hooks/useClients'\n",
    to: "import { useClients } from '../../../shared/hooks/useClients'\nimport { Card } from '../../../components/ui'\n",
  },
  {
    label: 'benefit ledger command import',
    from: `  cancelSubscriptionCommand,
  loadPackageAppointmentsCommand,`,
    to: `  cancelSubscriptionCommand,
  loadPackageAppointmentsCommand,
  loadSubscriptionBenefitLedgerCommand,`,
  },
  {
    label: 'usage helpers import',
    from: `  buildEditableUsage,
  clampSubscriptionUsage,
  normalizeSubscriptionSearch,`,
    to: `  benefitMovementDescription,
  buildEditableUsage,
  clampSubscriptionUsage,
  normalizeBenefitLedger,
  normalizeSubscriptionSearch,`,
  },
  {
    label: 'remove old usage summary import',
    from: `  buildCatalogUsageSummary,
  catalogServiceMap,`,
    to: `  catalogServiceMap,`,
  },
  {
    label: 'usage modal clarity',
    from: `<p className="mt-1 text-xs text-muted">Limite contratado: {item.total} por ciclo</p>`,
    to: `<p className="mt-1 text-xs text-muted">Capacidade: {item.total} · Saldo disponível: {item.available}</p>
                  <p className="mt-1 text-[11px] text-muted">Reservado: {item.reserved} · Consumido por atendimento: {item.consumed} · Ajuste manual/histórico: {item.manual_used}</p>`,
  },
  {
    label: 'benefit ledger modal',
    from: `function CancelSubscriptionModal({ subscription, onClose, onConfirm }) {`,
    to: `function BenefitLedgerModal({ subscription, activeTenantId, moduleId, onClose }) {
  const [benefits, setBenefits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    loadSubscriptionBenefitLedgerCommand({ tenantId: activeTenantId, moduleId, subscriptionId: subscription.id })
      .then((rows) => { if (active) setBenefits(normalizeBenefitLedger(rows)) })
      .catch((loadError) => { if (active) setError(loadError?.message || 'Não foi possível carregar a origem do saldo.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activeTenantId, moduleId, subscription.id])

  const movementDate = (value) => {
    if (!value) return '-'
    const date = DateTime.fromISO(String(value)).setZone(PETSHOP_ZONE)
    return date.isValid ? date.toFormat('dd/LL/yyyy HH:mm') : '-'
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-5xl">
        <div className="modal-header">
          <div>
            <h2 className="font-display text-xl font-bold text-text">Saldo e origem do pacote</h2>
            <p className="mt-1 text-sm text-muted">{subscription.client?.pet_name || subscription.client?.owner_name} · {subscription.subscription_plans?.name}</p>
          </div>
          <button type="button" aria-label="Fechar saldo do pacote" onClick={onClose} className="text-muted hover:text-text"><X size={18}/></button>
        </div>
        <div className="modal-body space-y-4">
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-text">
            Pagamento ativa o ciclo; reservas ocupam capacidade; consumo só é confirmado pelos atendimentos concluídos ou por ajuste administrativo explícito. Ajustes sem vínculo permanecem identificados como tal.
          </div>
          {loading && <p className="py-8 text-center text-sm text-muted">Carregando rastreabilidade do saldo...</p>}
          {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
          {!loading && !error && benefits.map((benefit) => (
            <Card key={benefit.benefit_key} className="overflow-hidden">
              <div className="border-b border-[var(--border2)] px-4 py-3">
                <p className="font-semibold text-text">{benefit.label}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <span>Capacidade <strong className="text-text">{benefit.capacity}</strong></span>
                  <span>Disponível <strong className="text-emerald-400">{benefit.available}</strong></span>
                  <span>Reservado <strong className="text-amber-400">{benefit.reserved}</strong></span>
                  <span>Consumido <strong className="text-text">{benefit.used}</strong></span>
                  <span>Ajustes <strong className="text-text">{benefit.manual_or_historical}</strong></span>
                </div>
              </div>
              <div className="space-y-2 p-4">
                {benefit.movements.map((movement) => (
                  <Card key={movement.id} tone="subtle" className="p-3 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-text">{benefitMovementDescription(movement)}{movement.quantity > 1 ? ` · ${movement.quantity}x` : ''}</p>
                        <p className="mt-1 text-muted">{movement.origin_known ? `Atendimento: ${movement.appointment_id}` : 'Origem: ajuste sem atendimento vinculado'}</p>
                      </div>
                      <span className="badge badge-gray">{movement.state === 'reserved' ? 'Reservado' : movement.state === 'released' ? 'Liberado' : 'Consumido'}</span>
                    </div>
                    {movement.origin_known && <p className="mt-2 text-muted">Agendado: {movementDate(movement.scheduled_at)} · Status: {movement.appointment_status || '-'}</p>}
                    <p className="mt-1 text-muted">Registrado: {movementDate(movement.recorded_at)}</p>
                  </Card>
                ))}
                {!benefit.movements.length && <p className="text-sm text-muted">Nenhum movimento registrado para este benefício.</p>}
              </div>
            </Card>
          ))}
          {!loading && !error && !benefits.length && <p className="py-8 text-center text-sm text-muted">Nenhum benefício encontrado neste ciclo.</p>}
          <div className="flex justify-end"><button type="button" onClick={onClose} className="btn btn-secondary">Fechar</button></div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CancelSubscriptionModal({ subscription, onClose, onConfirm }) {`,
  },
  {
    label: 'benefit modal state',
    from: `  const [editingUsage, setEditingUsage] = useState(null)
  const [managingAppointments, setManagingAppointments] = useState(null)`,
    to: `  const [editingUsage, setEditingUsage] = useState(null)
  const [viewingBenefits, setViewingBenefits] = useState(null)
  const [managingAppointments, setManagingAppointments] = useState(null)`,
  },
  {
    label: 'package flow clarity',
    from: `<p className="mt-1 text-sm text-muted">Ao consumir todos os serviços do ciclo, o pacote fica concluído. A renovação solicita a nova agenda antes de abrir a cobrança e preserva o ciclo anterior no histórico.</p>`,
    to: `<p className="mt-1 text-sm text-muted">Pagamento e ativação abrem o ciclo, mas não consomem benefícios. Agendamentos reservam capacidade; somente conclusão do atendimento ou ajuste administrativo explícito altera o consumo. A renovação preserva o ciclo anterior no histórico.</p>`,
  },
  {
    label: 'subscriber usage summary',
    from: `                const usage = buildCatalogUsageSummary(subscription, catalogServices)`,
    to: `                const usage = buildEditableUsage(subscription)`,
  },
  {
    label: 'subscriber usage cell',
    from: `<td><div className="flex max-w-xl flex-wrap gap-2">{usage.map((item) => <span key={\`${'${'}subscription.id}-${'${'}item.service_type}\`} className={\`badge ${'${'}item.remaining > 0 ? 'badge-blue' : 'badge-gray'}\`}>{item.label}: {item.used}/{item.total}</span>)}</div></td>`,
    to: `<td><div className="flex max-w-2xl flex-wrap gap-2">{usage.map((item) => <span key={\`${'${'}subscription.id}-${'${'}item.service_type}\`} className={\`badge ${'${'}item.available > 0 ? 'badge-blue' : 'badge-gray'}\`}>{item.service_name}: saldo {item.available}/{item.total} · reservado {item.reserved} · consumido {item.used}</span>)}</div></td>`,
  },
  {
    label: 'subscriber benefit action',
    from: `{subscription.status === 'active' && <button type="button" onClick={() => setManagingAppointments(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap"><CalendarClock size={13}/> Agendamentos</button>}
                        <button type="button" disabled={!editable} onClick={() => setEditingUsage(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap" title={editable ? 'Editar consumo do ciclo' : 'Disponível após ativação'}><PencilLine size={13}/> Editar consumo</button>`,
    to: `{subscription.status === 'active' && <button type="button" onClick={() => setManagingAppointments(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap"><CalendarClock size={13}/> Agendamentos</button>}
                        <button type="button" onClick={() => setViewingBenefits(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap"><PackageCheck size={13}/> Saldo e origem</button>
                        <button type="button" disabled={!editable} onClick={() => setEditingUsage(subscription)} className="btn btn-secondary btn-sm whitespace-nowrap" title={editable ? 'Editar consumo do ciclo' : 'Disponível após ativação'}><PencilLine size={13}/> Editar consumo</button>`,
  },
  {
    label: 'benefit modal render',
    from: `      {managingAppointments && <PackageAppointmentsModal subscription={managingAppointments} activeTenantId={activeTenantId} moduleId={moduleId} onClose={() => setManagingAppointments(null)} onChanged={reload}/>} 
      {editingUsage && <UsageEditModal subscription={editingUsage} onClose={() => setEditingUsage(null)} onSave={saveUsage}/>} `,
    to: `      {managingAppointments && <PackageAppointmentsModal subscription={managingAppointments} activeTenantId={activeTenantId} moduleId={moduleId} onClose={() => setManagingAppointments(null)} onChanged={reload}/>} 
      {viewingBenefits && <BenefitLedgerModal subscription={viewingBenefits} activeTenantId={activeTenantId} moduleId={moduleId} onClose={() => setViewingBenefits(null)}/>} 
      {editingUsage && <UsageEditModal subscription={editingUsage} onClose={() => setEditingUsage(null)} onSave={saveUsage}/>} `,
  },
])

await patch('src/modules/petshop/pages/EquipePage.jsx', [
  {
    label: 'commission queue and base label imports',
    from: `  appointmentHasCommissionServices,
  buildCommissionRows,
  commissionHistoryLabel,`,
    to: `  appointmentHasCommissionServices,
  buildCommissionQueues,
  buildCommissionRows,
  commissionBaseSourceLabel,
  commissionHistoryLabel,`,
  },
  {
    label: 'commission queue derivation',
    from: `  const displayRows = useMemo(
    () => buildCommissionRows(commissionServiceHistory, configuredStaff),
    [configuredStaff, commissionServiceHistory],
  )
  const commissionPendingServices = useMemo(
    () => hydratedPendingServices.filter(afterCommissionReset).filter(appointmentHasCommissionServices),
    [hydratedPendingServices, commissionResetAt],
  )`,
    to: `  const commissionCandidates = useMemo(() => {
    const byId = new Map()
    ;[...hydratedPendingServices, ...hydratedServiceHistory]
      .filter(afterCommissionReset)
      .filter(appointmentHasCommissionServices)
      .forEach((appointment) => byId.set(appointment.id, appointment))
    return [...byId.values()]
  }, [hydratedPendingServices, hydratedServiceHistory, commissionResetAt])
  const commissionQueues = useMemo(
    () => buildCommissionQueues(commissionCandidates),
    [commissionCandidates],
  )
  const commissionPendingServices = commissionQueues.pendingResponsible
  const commissionRulePendingServices = commissionQueues.pendingRuleSnapshot
  const commissionReadyHistory = commissionQueues.ready
  const displayRows = useMemo(
    () => buildCommissionRows(commissionReadyHistory, configuredStaff),
    [configuredStaff, commissionReadyHistory],
  )`,
  },
  {
    label: 'selected ready history only',
    from: `  const selectedHistoryItems = useMemo(() => historyRow?.staff_key
    ? commissionServiceHistory.filter((item) => (
      item.responsible_staff_key === historyRow.staff_key
      && appointmentHasCommissionServices(item)
    ))
    : [], [historyRow, commissionServiceHistory])`,
    to: `  const selectedHistoryItems = useMemo(() => historyRow?.staff_key
    ? commissionReadyHistory.filter((item) => (
      item.responsible_staff_key === historyRow.staff_key
      && appointmentHasCommissionServices(item)
    ))
    : [], [historyRow, commissionReadyHistory])`,
  },
  {
    label: 'commission explanatory copy',
    from: `As comissões seguem as regras configuradas no catálogo e preservam as taxas registradas na conclusão de cada serviço. Pacotes usam o valor líquido por unidade, descontado o transporte antes da divisão.`,
    to: `Somente a regra gravada no atendimento entra no fechamento. Alterações atuais do catálogo não reescrevem o histórico; itens sem snapshot ficam separados para revisão. Em pacotes, a origem da base também fica visível quando precisa ser reconstruída pelo plano atual.`,
  },
  {
    label: 'commission missing rule panel',
    from: `          <div className="tbl-wrapper overflow-x-auto">`,
    to: `          {commissionRulePendingServices.length > 0 && (
            <Card tone="warning" className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 text-amber-400"/>
                <div>
                  <p className="font-semibold text-text">Itens com regra histórica ausente</p>
                  <p className="mt-1 text-sm text-muted">Eles não entram no total a pagar. O YuiSync não aplica a configuração atual retroativamente quando o atendimento não possui snapshot de comissão.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {commissionRulePendingServices.slice(0, 12).map((appointment) => {
                  const unresolvedLines = appointmentCommissionLines(appointment).filter((line) => line.rule_snapshot_missing)
                  return unresolvedLines.map((line, index) => (
                    <Card key={\`${'${'}appointment.id}:${'${'}index}\`} tone="subtle" className="p-4 text-sm">
                      <p className="font-semibold text-text">{appointment.client?.pet_name || appointment.client?.owner_name || 'Pet'} · {line.label}</p>
                      <p className="mt-1 text-xs text-muted">Responsável: {line.responsible_staff_name || line.responsible_staff_key || '-'}</p>
                      <p className="mt-1 text-xs text-muted">Data: {dateLabel(appointment.scheduled_at)} · Origem: {line.appointment_source || appointment.source || 'atendimento'}</p>
                      <p className="mt-1 text-xs text-muted">Base: {fmtCurrency(line.revenue)} · {commissionBaseSourceLabel(line.base_source)}</p>
                      <p className="mt-2 text-xs font-semibold text-amber-300">Regra histórica não registrada · comissão não calculada</p>
                    </Card>
                  ))
                })}
              </div>
            </Card>
          )}

          <div className="tbl-wrapper overflow-x-auto">`,
  },
  {
    label: 'Card import in team page',
    from: `import { MetricCard } from '../../../components/ui'`,
    to: `import { Card, MetricCard } from '../../../components/ui'`,
  },
  {
    label: 'history print rows',
    from: `    const rows = lineRows.map(({ appointment, line }) => \`<tr>
      <td>${'${'}escapeHtml(dateLabel(appointment.scheduled_at))}</td>
      <td>${'${'}escapeHtml(appointment.client?.owner_name || '-')}</td>
      <td>${'${'}escapeHtml(appointment.client?.pet_name || '-')}</td>
      <td>${'${'}escapeHtml(line.label)}</td>
      <td class="money">${'${'}escapeHtml(fmtCurrency(line.revenue))}</td>
      <td class="money">${'${'}escapeHtml(fmtCurrency(line.commission))}</td>
    </tr>\`).join('')`,
    to: `    const rows = lineRows.map(({ appointment, line }) => \`<tr>
      <td>${'${'}escapeHtml(dateLabel(appointment.scheduled_at))}</td>
      <td>${'${'}escapeHtml(line.appointment_source || appointment.source || 'atendimento')}</td>
      <td>${'${'}escapeHtml(line.responsible_staff_name || responsibleName)}</td>
      <td>${'${'}escapeHtml(appointment.client?.owner_name || '-')}</td>
      <td>${'${'}escapeHtml(appointment.client?.pet_name || '-')}</td>
      <td>${'${'}escapeHtml(line.label)}</td>
      <td class="money">${'${'}escapeHtml(fmtCurrency(line.revenue))}<br/><small>${'${'}escapeHtml(commissionBaseSourceLabel(line.base_source))}</small></td>
      <td>${'${'}escapeHtml(line.commission_rule_label)}</td>
      <td class="money">${'${'}escapeHtml(fmtCurrency(line.commission))}</td>
    </tr>\`).join('')`,
  },
  {
    label: 'history print table',
    from: `      <div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th>Data</th><th>Tutor</th><th>Pet</th><th>Servico</th><th class="money">Valor</th><th class="money">Comissao</th></tr></thead>
      <tbody>${'${'}rows || '<tr><td colspan="6">Nenhum atendimento no periodo.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4"><strong>Totais</strong></td><td class="money"><strong>${'${'}escapeHtml(fmtCurrency(revenue))}</strong></td><td class="money"><strong>${'${'}escapeHtml(fmtCurrency(commission))}</strong></td></tr></tfoot></table></div>`,
    to: `      <div class="receipt-table-wrap"><table class="receipt-table"><thead><tr><th>Data</th><th>Origem</th><th>Responsável</th><th>Tutor</th><th>Pet</th><th>Serviço</th><th class="money">Base</th><th>Regra</th><th class="money">Comissão</th></tr></thead>
      <tbody>${'${'}rows || '<tr><td colspan="9">Nenhum atendimento no periodo.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6"><strong>Totais</strong></td><td class="money"><strong>${'${'}escapeHtml(fmtCurrency(revenue))}</strong></td><td></td><td class="money"><strong>${'${'}escapeHtml(fmtCurrency(commission))}</strong></td></tr></tfoot></table></div>`,
  },
  {
    label: 'history screen table',
    from: `            <table className="tbl min-w-[820px]">
              <thead><tr><th>Data</th><th>Tutor</th><th>Pet</th><th>Servico</th><th>Valor</th><th>Comissao</th></tr></thead>
              <tbody>
                {lineRows.map(({ id, appointment, line }) => (
                  <tr key={id}>
                    <td>{dateLabel(appointment.scheduled_at)}</td>
                    <td>{appointment.client?.owner_name || '-'}</td>
                    <td className="font-semibold text-text">{appointment.client?.pet_name || '-'}</td>
                    <td>{line.label}</td>
                    <td>{fmtCurrency(line.revenue)}</td>
                    <td className="font-semibold text-emerald-400">{fmtCurrency(line.commission)}</td>
                  </tr>
                ))}
                {!lineRows.length && <tr><td colSpan={6} className="py-10 text-center text-muted">Nenhum servico comissionavel no periodo.</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={4} className="font-bold text-text">Total conferido</td><td className="font-bold">{fmtCurrency(revenue)}</td><td className="font-bold text-emerald-400">{fmtCurrency(commission)}</td></tr></tfoot>
            </table>`,
    to: `            <table className="tbl min-w-[1320px]">
              <thead><tr><th>Data</th><th>Origem</th><th>Responsável</th><th>Tutor</th><th>Pet</th><th>Serviço</th><th>Base</th><th>Regra registrada</th><th>Comissão</th></tr></thead>
              <tbody>
                {lineRows.map(({ id, appointment, line }) => (
                  <tr key={id}>
                    <td>{dateLabel(appointment.scheduled_at)}</td>
                    <td>{line.appointment_source || appointment.source || 'atendimento'}</td>
                    <td>{line.responsible_staff_name || responsibleName}</td>
                    <td>{appointment.client?.owner_name || '-'}</td>
                    <td className="font-semibold text-text">{appointment.client?.pet_name || '-'}</td>
                    <td>{line.label}</td>
                    <td><p>{fmtCurrency(line.revenue)}</p><p className="mt-1 text-[10px] text-muted">{commissionBaseSourceLabel(line.base_source)}</p></td>
                    <td>{line.commission_rule_label}</td>
                    <td className="font-semibold text-emerald-400">{fmtCurrency(line.commission)}</td>
                  </tr>
                ))}
                {!lineRows.length && <tr><td colSpan={9} className="py-10 text-center text-muted">Nenhum servico comissionavel no periodo.</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={6} className="font-bold text-text">Total conferido</td><td className="font-bold">{fmtCurrency(revenue)}</td><td></td><td className="font-bold text-emerald-400">{fmtCurrency(commission)}</td></tr></tfoot>
            </table>`,
  },
])

console.log('Delivery 2 guarded patch applied successfully.')
