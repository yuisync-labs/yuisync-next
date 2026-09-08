import { readFile, writeFile } from 'node:fs/promises'

async function patchFile(path, replacements) {
  let text = await readFile(path, 'utf8')
  for (const { label, from, to } of replacements) {
    const count = text.split(from).length - 1
    if (count !== 1) throw new Error(`${path}: ${label} expected once, found ${count}`)
    text = text.replace(from, to)
  }
  await writeFile(path, text, 'utf8')
}

await patchFile('apps/edge-api/src/petshopAppointmentsApi.ts', [
  {
    label: 'client history filters',
    from: `  const serviceType = text(url.searchParams.get('service_type')) || null
  const employeeId = text(url.searchParams.get('employee_id')) || null

  const statement = bindings.DB!.prepare(\`${'${APPOINTMENT_READ_SQL}'}
    WHERE a.tenant_id=?1 AND a.module_id=?2
      AND (?3 IS NULL OR a.id=?3)
      AND (?4 IS NULL OR a.scheduled_at_ms>=?4)
      AND (?5 IS NULL OR a.scheduled_at_ms<=?5)
      AND (?6 IS NULL OR a.status=?6)
      AND (?7 IS NULL OR a.employee_id=?7 OR a.groomer_id=?7 OR a.responsible_staff_key=?7)
      AND (?8 IS NULL OR EXISTS(SELECT 1 FROM appointment_services sx
        WHERE sx.tenant_id=a.tenant_id AND sx.module_id=a.module_id AND sx.appointment_id=a.id AND sx.service_code=?8))
    ORDER BY a.scheduled_at_ms,a.id
    LIMIT ?9
  \`).bind(scope.tenantId, scope.moduleId, appointmentId || null, start, end, status, employeeId, serviceType, appointmentId ? 1 : 500)`,
    to: `  const serviceType = text(url.searchParams.get('service_type')) || null
  const employeeId = text(url.searchParams.get('employee_id')) || null
  const requestedClientId = text(url.searchParams.get('client_id'))
  if (requestedClientId && !ID.test(requestedClientId)) return json({ code: 'INVALID_CLIENT_ID' }, 400)
  const clientId = requestedClientId || null
  const requestedLimit = Number(url.searchParams.get('limit'))
  const listLimit = clientId
    ? Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 12))
    : 500
  const orderDirection = url.searchParams.get('sort') === 'desc' ? 'DESC' : 'ASC'

  const statement = bindings.DB!.prepare(\`${'${APPOINTMENT_READ_SQL}'}
    WHERE a.tenant_id=?1 AND a.module_id=?2
      AND (?3 IS NULL OR a.id=?3)
      AND (?4 IS NULL OR a.scheduled_at_ms>=?4)
      AND (?5 IS NULL OR a.scheduled_at_ms<=?5)
      AND (?6 IS NULL OR a.status=?6)
      AND (?7 IS NULL OR a.employee_id=?7 OR a.groomer_id=?7 OR a.responsible_staff_key=?7)
      AND (?8 IS NULL OR EXISTS(SELECT 1 FROM appointment_services sx
        WHERE sx.tenant_id=a.tenant_id AND sx.module_id=a.module_id AND sx.appointment_id=a.id AND sx.service_code=?8))
      AND (?9 IS NULL OR a.client_id=?9)
    ORDER BY a.scheduled_at_ms ${'${orderDirection}'},a.id ${'${orderDirection}'}
    LIMIT ?10
  \`).bind(
    scope.tenantId,
    scope.moduleId,
    appointmentId || null,
    start,
    end,
    status,
    employeeId,
    serviceType,
    clientId,
    appointmentId ? 1 : listLimit,
  )`,
  },
])

await patchFile('src/modules/petshop/lib/appointmentCommands.js', [
  {
    label: 'visual preview client history filters',
    from: `            ['service_type', 'eq', url.searchParams.get('service_type')],
            ['employee_id', 'eq', url.searchParams.get('employee_id')],
          ].filter(([, , value]) => value).map(([column, op, value]) => ({ column, op, value }))
      const result = runVisualPreviewQuery({ table: 'appointments', filters, orders: [{ column: 'scheduled_at', ascending: true }] })`,
    to: `            ['service_type', 'eq', url.searchParams.get('service_type')],
            ['employee_id', 'eq', url.searchParams.get('employee_id')],
            ['client_id', 'eq', url.searchParams.get('client_id')],
          ].filter(([, , value]) => value).map(([column, op, value]) => ({ column, op, value }))
      const descending = url.searchParams.get('sort') === 'desc'
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 500))
      const result = runVisualPreviewQuery({ table: 'appointments', filters, orders: [{ column: 'scheduled_at', ascending: !descending }], limit })`,
  },
])

await patchFile('src/modules/petshop/components/AgendaAppointmentPanel.jsx', [
  {
    label: 'grooming machine import',
    from: `import { appointmentCheckoutTotals } from '../pages/appointmentCheckoutFlow'`,
    to: `import { appointmentCheckoutTotals } from '../pages/appointmentCheckoutFlow'
import { appointmentRequiresGroomingMachineNumber } from '../lib/groomingMachinePolicy'`,
  },
  {
    label: 'complete callback prop',
    from: `  onStatus,
  onCompletedAction,
}) {`,
    to: `  onStatus,
  onCompleteWithMachine,
  onCompletedAction,
}) {`,
  },
  {
    label: 'machine state',
    from: `  const [savingAction, setSavingAction] = useState(false)
  const [actionError, setActionError] = useState('')`,
    to: `  const [savingAction, setSavingAction] = useState(false)
  const [actionError, setActionError] = useState('')
  const [machineNo, setMachineNo] = useState(null)`,
  },
  {
    label: 'machine requirement',
    from: `  const nextAction = appointmentPanelAction(appointment?.status)
  const responsible = staffById.get(appointment?.responsible_staff_key)?.name`,
    to: `  const nextAction = appointmentPanelAction(appointment?.status)
  const needsMachineNumber = nextAction?.status === 'concluido'
    && appointmentRequiresGroomingMachineNumber(appointment || {}, [])
  const responsible = staffById.get(appointment?.responsible_staff_key)?.name`,
  },
  {
    label: 'atomic completion action',
    from: `    try {
      await onStatus(appointment.id, nextAction.status)
    } catch (error) {`,
    to: `    try {
      if (needsMachineNumber) await onCompleteWithMachine(appointment.id, machineNo)
      else await onStatus(appointment.id, nextAction.status)
    } catch (error) {`,
  },
  {
    label: 'machine selector',
    from: `        {actionError && (
          <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">`,
    to: `        {needsMachineNumber && (
          <Panel title="Nº da máquina" icon={Scissors} description="Opcional. Será salvo junto com a conclusão, na mesma atualização.">
            <div className="grid grid-cols-4 gap-2">
              {[4, 7, 10].map((value) => (
                <button key={value} type="button" className={\`btn btn-sm justify-center ${'${'}machineNo === value ? 'btn-primary' : 'btn-secondary'}\`} onClick={() => setMachineNo(value)}>Nº {value}</button>
              ))}
              <button type="button" className={\`btn btn-sm justify-center ${'${'}machineNo === null ? 'btn-primary' : 'btn-secondary'}\`} onClick={() => setMachineNo(null)}>Sem Nº</button>
            </div>
          </Panel>
        )}

        {actionError && (
          <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">`,
  },
])

await patchFile('src/modules/petshop/pages/AgendaPage.jsx', [
  {
    label: 'appointment panel import',
    from: `import { AgendaBillingLabel } from '../components/AgendaBillingLabel'`,
    to: `import { AgendaBillingLabel } from '../components/AgendaBillingLabel'
import { AgendaAppointmentPanel } from '../components/AgendaAppointmentPanel'`,
  },
  {
    label: 'panel state',
    from: `  const [receipt,      setReceipt]      = useState(null)
  const view = 'agenda'`,
    to: `  const [receipt,      setReceipt]      = useState(null)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null)
  const agendaScrollPositionRef = useRef(null)
  const view = 'agenda'`,
  },
  {
    label: 'selected appointment derivation',
    from: `  const deferredSearch = useDeferredValue(search)

  const displayed = useMemo(() => {`,
    to: `  const deferredSearch = useDeferredValue(search)
  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => String(appointment.id) === String(selectedAppointmentId || '')) || null,
    [appointments, selectedAppointmentId],
  )

  const displayed = useMemo(() => {`,
  },
  {
    label: 'panel open close helpers',
    from: `  const openSlotModal = (slotDate) => {
    setSelectedDate(slotDate)
    setModal({ scheduled_at: slotDate.toISOString(), service_group: activeAgendaTab })
  }
`,
    to: `  const openSlotModal = (slotDate) => {
    setSelectedDate(slotDate)
    setModal({ scheduled_at: slotDate.toISOString(), service_group: activeAgendaTab })
  }

  const openAppointmentPanel = (appointment) => {
    if (!appointment?.id) return
    if (!selectedAppointmentId) {
      const scroller = document.querySelector('main')
      agendaScrollPositionRef.current = scroller ? scroller.scrollTop : null
    }
    setSelectedAppointmentId(appointment.id)
  }

  const closeAppointmentPanel = () => {
    setSelectedAppointmentId(null)
    const savedScrollTop = agendaScrollPositionRef.current
    agendaScrollPositionRef.current = null
    if (savedScrollTop === null || savedScrollTop === undefined) return
    requestAnimationFrame(() => {
      const scroller = document.querySelector('main')
      if (scroller) scroller.scrollTop = savedScrollTop
    })
  }

  const completeAppointmentWithMachine = async (appointmentId, groomingMachineNo) => {
    if (!window.confirm('Concluir este atendimento?')) return null
    const updated = await update(appointmentId, {
      status: 'concluido',
      grooming_machine_no: groomingMachineNo,
    })
    if (updated) handleCompletedAction(updated)
    return updated
  }
`,
  },
  {
    label: 'regional loading wrapper start',
    from: `      {/* Content */}
      <div key={\`${'${'}view}-${'${'}localAgendaPeriod}-${'${'}selectedDate.toISOString().slice(0, 10)}\`} className="yuisync-agenda-view-transition">
        {loading ? (`,
    to: `      {/* Content */}
      <div className={selectedAppointment ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start xl:gap-4' : ''}>
        <div className="min-w-0" aria-busy={loading || undefined}>
          {loading && appointments.length > 0 && (
            <div role="status" aria-live="polite" className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border2)] bg-surface px-3 py-2 text-xs text-muted">
              <RefreshCw size={13} className="animate-spin"/> Atualizando agenda…
            </div>
          )}
          <div key={\`${'${'}view}-${'${'}localAgendaPeriod}-${'${'}selectedDate.toISOString().slice(0, 10)}\`} className="yuisync-agenda-view-transition">
        {loading && appointments.length === 0 ? (`,
  },
  {
    label: 'timeline click opens panel',
    from: `              onEdit={(appt) => setModal(appt)}`,
    to: `              onEdit={openAppointmentPanel}`,
  },
  {
    label: 'panel wrapper close',
    from: `        )}
      </div>

      {/* Modals */}`,
    to: `        )}
          </div>
        </div>
        {selectedAppointment && (
          <AgendaAppointmentPanel
            appointment={selectedAppointment}
            staffById={operationalStaffById}
            serviceLabel={(appointment) => serviceLabel(appointment, agendaServices)}
            statusBadge={statusBadge}
            transportOptions={transportOptions}
            needsPayment={needsAppointmentPayment}
            onClose={closeAppointmentPanel}
            onEdit={(appointment) => setModal(appointment)}
            onStatus={handleStatusChange}
            onCompleteWithMachine={completeAppointmentWithMachine}
            onCompletedAction={handleCompletedAction}
          />
        )}
      </div>

      {/* Modals */}`,
  },
])

await patchFile('test/e2e/agenda-drag-semantic.spec.js', [
  {
    label: 'drag must not open panel',
    from: `  await expect(page.getByText(/Agendamento movido para 08:50/i)).toBeVisible()
  await expect(card).toContainText('08:50')`,
    to: `  await expect(page.getByText(/Agendamento movido para 08:50/i)).toBeVisible()
  await expect(card).toContainText('08:50')
  await expect(page.locator('[data-qa="agenda-appointment-panel"]')).toHaveCount(0)`,
  },
])

console.log('Delivery 3 agenda panel patch applied successfully.')
