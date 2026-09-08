import { saveAssistedTeam } from '../../../lib/assistedOnboardingApi'
import {
  normalizeOperationalStaff,
  PETSHOP_COMMISSION_RESET_TEMPLATE_KEY,
} from '../../../../shared/petshopOperations'

export const OPERATIONAL_STAFF_TEMPLATE_KEY = '__petshop_operational_staff'

export async function persistPetshopTeamSettings({
  moduleId = 'petshop',
  tenantId,
  currentSettings = {},
  staff = [],
  templatePatch = {},
}) {
  if (moduleId !== 'petshop') throw new Error('Modulo de equipe nao suportado.')
  if (!tenantId) throw new Error('Empresa ativa nao identificada.')

  const unsupportedTemplateKeys = Object.keys(templatePatch).filter((key) => key !== PETSHOP_COMMISSION_RESET_TEMPLATE_KEY)
  if (unsupportedTemplateKeys.length) throw new Error('Patch de template nao suportado pela operacao nativa de equipe.')

  const expectedStaff = normalizeOperationalStaff(staff)
  const commissionResetAt = templatePatch[PETSHOP_COMMISSION_RESET_TEMPLATE_KEY]
  const snapshot = await saveAssistedTeam(tenantId, expectedStaff, { commissionResetAt })
  const savedStaff = normalizeOperationalStaff(snapshot?.team ?? expectedStaff)
  const templates = {
    ...(currentSettings.message_templates || {}),
    [OPERATIONAL_STAFF_TEMPLATE_KEY]: savedStaff,
    ...templatePatch,
  }

  return {
    petshop_operational_staff: savedStaff,
    message_templates: templates,
  }
}
