import {expect,it,vi} from 'vitest'
import {persistPetshopTeamSettings} from './teamSettingsOperations'
import {saveAssistedTeam} from '../../../lib/assistedOnboardingApi'
vi.mock('../../../lib/assistedOnboardingApi',()=>({saveAssistedTeam:vi.fn()}))
it('salva nome e marcador de ativo de Neto preservando a configuracao das comissoes',async()=>{
 const staff=[{key:'esteticista-1',name:'Thaiane',active:true},{key:'esteticista-2',name:'Estefanea',active:true},{key:'esteticista-3',name:'Neto editado',active:false}]
 vi.mocked(saveAssistedTeam).mockResolvedValue({team:staff})
 const saved=await persistPetshopTeamSettings({tenantId:'tenant',staff,currentSettings:{message_templates:{__petshop_commission_reset_at:'2026-07-31T12:52:26.793Z'}}})
 expect(saveAssistedTeam).toHaveBeenCalledWith('tenant',staff,{commissionResetAt:undefined})
 expect(saved.petshop_operational_staff[2]).toEqual(staff[2])
 expect(saved.message_templates.__petshop_operational_staff).toEqual(staff)
 expect(saved.message_templates.__petshop_commission_reset_at).toBe('2026-07-31T12:52:26.793Z')
})
