import { useRef, useState } from 'react'
import { useAuthCtx } from '../../../context/AuthContext'
import { useModuleCtx } from '../../../context/ModuleContext'
import { normalizeOperationalStaff } from '../../../../shared/petshopOperations'
import { persistPetshopTeamSettings, OPERATIONAL_STAFF_TEMPLATE_KEY } from '../lib/teamSettingsOperations'

export function AgendaStaffControls() {
  const auth = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const { storeSettings = {}, activeTenantId } = auth
  const staff = normalizeOperationalStaff(storeSettings.petshop_operational_staff)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)

  async function toggleStaff(person, active) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    const nextStaff = staff.map((item) => item.key === person.key ? { ...item, active } : item)
    const optimistic = {
      petshop_operational_staff: nextStaff,
      message_templates: {
        ...(storeSettings.message_templates || {}),
        [OPERATIONAL_STAFF_TEMPLATE_KEY]: nextStaff,
      },
    }
    auth.updateStoreSettings?.(optimistic)
    try {
      const saved = await persistPetshopTeamSettings({
        moduleId: activeModuleId || 'petshop',
        tenantId: activeTenantId,
        currentSettings: storeSettings,
        staff: nextStaff,
      })
      auth.updateStoreSettings?.(saved)
    } catch (err) {
      auth.updateStoreSettings?.(storeSettings)
      setError(err.message || 'Não foi possível salvar as esteticistas ativas.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <fieldset className="rounded-xl border border-[var(--border)] p-3" aria-busy={saving}>
      <legend className="px-1 text-xs font-bold">Esteticistas ativas na agenda</legend>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {staff.map((person) => (
          <label key={person.key} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={person.active !== false} disabled={saving}
              onChange={(event) => toggleStaff(person, event.target.checked)} />
            {person.name}
          </label>
        ))}
        {saving && <span role="status" className="text-xs text-muted">Salvando...</span>}
      </div>
      <p className="mt-2 text-xs text-muted">Marque quem atende. A agenda mostra uma coluna por esteticista ativa.</p>
      {error && <p role="alert" className="mt-2 text-xs text-[var(--ui-danger-fg)]">{error}</p>}
    </fieldset>
  )
}
