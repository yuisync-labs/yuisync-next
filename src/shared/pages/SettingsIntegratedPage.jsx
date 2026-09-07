import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Image as ImageIcon, Printer, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import SettingsPage from './SettingsPage'
import { useAuthCtx } from '../../context/AuthContext'
import { useModuleCtx } from '../../context/ModuleContext'
import { getAppSettings, patchAppSettings } from '../../lib/api'

const EMPTY_COMPANY_FORM = {
  business_name: '',
  business_address: '',
  business_phone: '',
  business_email: '',
  business_tax_id: '',
  logo_url: '',
  receipt_format: '80',
  receipt_footer: '',
}

function modulePermissionIsAdmin(permission) {
  if (typeof permission === 'string') return permission.startsWith('admin_')
  if (permission && typeof permission === 'object') {
    return permission.admin === true || String(permission.role || '').startsWith('admin_')
  }
  return false
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('O arquivo selecionado nao e uma imagem valida.'))
    image.src = dataUrl
  })
}

async function prepareReceiptLogo(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file?.type)) {
    throw new Error('Selecione uma imagem PNG, JPG ou WEBP.')
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter no maximo 5 MB.')

  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  const maxWidth = 640
  const maxHeight = 220
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('O navegador nao conseguiu preparar a imagem.')

  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255
    const red = pixels[index] * alpha + 255 * (1 - alpha)
    const green = pixels[index + 1] * alpha + 255 * (1 - alpha)
    const blue = pixels[index + 2] * alpha + 255 * (1 - alpha)
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114
    const monochrome = luminance >= 176 ? 255 : 0
    pixels[index] = monochrome
    pixels[index + 1] = monochrome
    pixels[index + 2] = monochrome
    pixels[index + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
  const result = canvas.toDataURL('image/png')
  if (result.length > 200_000) throw new Error('A logo ficou muito grande. Use uma imagem com menos detalhes.')
  return result
}

function normalizeCompanySettings(settings = {}) {
  const receiptFormat = ['58', '80', 'a4'].includes(settings.receipt_format)
    ? settings.receipt_format
    : settings.printer_width === '58' ? '58' : '80'
  return {
    business_name: String(settings.business_name || settings.store_name || ''),
    business_address: String(settings.business_address || settings.store_address || ''),
    business_phone: String(settings.business_phone || settings.store_phone || ''),
    business_email: String(settings.business_email || ''),
    business_tax_id: String(settings.business_tax_id || ''),
    logo_url: String(settings.logo_url || settings.receipt_logo_data_url || ''),
    receipt_format: receiptFormat,
    receipt_footer: String(settings.receipt_footer || ''),
  }
}

function CompanySettingsSection() {
  const auth = useAuthCtx()
  const { activeModuleId } = useModuleCtx()
  const [form, setForm] = useState(EMPTY_COMPANY_FORM)
  const [dirtyFields, setDirtyFields] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [processingLogo, setProcessingLogo] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const fileRef = useRef(null)

  const activeTenant = useMemo(
    () => (auth.tenants || []).find((tenant) => tenant.id === auth.activeTenantId) || null,
    [auth.tenants, auth.activeTenantId],
  )
  const permission = auth.profile?.module_permissions?.[activeModuleId]
  const canEdit = ['owner', 'admin'].includes(auth.profile?.role) || modulePermissionIsAdmin(permission)

  useEffect(() => {
    if (activeModuleId !== 'petshop' || !auth.activeTenantId) {
      setForm(EMPTY_COMPANY_FORM)
      setDirtyFields(new Set())
      setMessage({ type: '', text: '' })
      setLoading(false)
      return undefined
    }

    let cancelled = false
    const tenantId = auth.activeTenantId
    setForm(EMPTY_COMPANY_FORM)
    setDirtyFields(new Set())
    setMessage({ type: '', text: '' })
    setLoading(true)

    getAppSettings({ tenantId, moduleId: activeModuleId })
      .then((response) => {
        if (!cancelled) setForm(normalizeCompanySettings(response?.settings || {}))
      })
      .catch((error) => {
        if (!cancelled) setMessage({ type: 'error', text: error?.message || 'Nao foi possivel carregar os dados da empresa.' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeModuleId, auth.activeTenantId])

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setDirtyFields((current) => new Set(current).add(field))
    setMessage({ type: '', text: '' })
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProcessingLogo(true)
    setMessage({ type: '', text: '' })
    try {
      updateField('logo_url', await prepareReceiptLogo(file))
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel preparar a logo.' })
    } finally {
      setProcessingLogo(false)
    }
  }

  const save = async () => {
    if (!auth.activeTenantId || activeModuleId !== 'petshop' || !canEdit || dirtyFields.size === 0) return
    const tenantId = auth.activeTenantId
    const patch = Object.fromEntries([...dirtyFields].map((field) => [field, form[field]]))
    setSaving(true)
    setMessage({ type: '', text: '' })
    try {
      const response = await patchAppSettings({ tenantId, moduleId: activeModuleId, patch })
      if (tenantId !== auth.activeTenantId) return
      const saved = response?.settings || {}
      setForm(normalizeCompanySettings(saved))
      setDirtyFields(new Set())
      auth.updateStoreSettings?.(saved)
      await auth.refreshSettings(activeModuleId)
      setMessage({ type: 'success', text: 'Dados da empresa salvos para este tenant.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Nao foi possivel salvar os dados da empresa.' })
    } finally {
      setSaving(false)
    }
  }

  if (activeModuleId !== 'petshop') return null

  return (
    <section className="page animate-fade-up max-w-5xl mx-auto pb-2" data-qa="tenant-company-settings">
      <div className="space-y-4">
        <h3 className="text-xs font-black text-muted uppercase tracking-[0.2em] flex items-center gap-2">
          <Building2 size={14}/> Empresa e comprovantes
        </h3>
        <div className="bg-card border border-white/5 rounded-3xl p-8 shadow-sm space-y-6">
          <div>
            <h4 className="font-bold text-text">Identidade desta empresa</h4>
            <p className="text-xs text-muted mt-1">Nome, contato, identificacao, logo e formato usados nos comprovantes. Os dados sao isolados por empresa.</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted"><RefreshCw size={15} className="animate-spin"/> Carregando empresa...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div><label className="inp-label">Nome exibido</label><input className="inp" disabled={!canEdit || saving} value={form.business_name} placeholder={activeTenant?.name || 'Estabelecimento'} onChange={(event) => updateField('business_name', event.target.value)}/></div>
                <div><label className="inp-label">Telefone</label><input className="inp" disabled={!canEdit || saving} value={form.business_phone} placeholder="Opcional" onChange={(event) => updateField('business_phone', event.target.value)}/></div>
                <div className="md:col-span-2"><label className="inp-label">Endereco</label><input className="inp" disabled={!canEdit || saving} value={form.business_address} placeholder="Endereco exibido no comprovante" onChange={(event) => updateField('business_address', event.target.value)}/></div>
                <div><label className="inp-label">E-mail</label><input className="inp" type="email" disabled={!canEdit || saving} value={form.business_email} placeholder="contato@empresa.com" onChange={(event) => updateField('business_email', event.target.value)}/></div>
                <div><label className="inp-label">CPF / CNPJ</label><input className="inp" disabled={!canEdit || saving} value={form.business_tax_id} placeholder="Opcional" onChange={(event) => updateField('business_tax_id', event.target.value)}/></div>
                <div className="md:col-span-2"><label className="inp-label">Rodape do comprovante</label><textarea className="inp min-h-24 resize-y" disabled={!canEdit || saving} value={form.receipt_footer} placeholder="Mensagem opcional" onChange={(event) => updateField('receipt_footer', event.target.value)}/></div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-5 border-t border-white/5 pt-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2"><ImageIcon size={16} className="text-emerald-400"/><div><h4 className="font-bold text-text">Logo do comprovante</h4><p className="text-xs text-muted">Sem logo configurada, o comprovante imprime apenas os dados da empresa.</p></div></div>
                  <div className="flex flex-wrap gap-3">
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile}/>
                    <button type="button" className="btn btn-secondary gap-2" disabled={!canEdit || processingLogo || saving} onClick={() => fileRef.current?.click()}><Upload size={14}/>{processingLogo ? 'Preparando...' : 'Enviar logo'}</button>
                    <button type="button" className="btn btn-secondary gap-2" disabled={!canEdit || !form.logo_url || processingLogo || saving} onClick={() => updateField('logo_url', '')}><Trash2 size={14}/> Remover</button>
                  </div>
                  <p className="text-[11px] text-muted">PNG, JPG ou WEBP. A imagem e normalizada para impressao e salva somente neste tenant.</p>
                </div>
                <div className="flex min-h-[116px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white p-4">
                  {form.logo_url ? <img src={form.logo_url} alt="Preview da logo do comprovante" className="max-h-24 max-w-full object-contain"/> : <span className="text-center text-xs font-bold uppercase tracking-widest text-gray-500">Sem logo</span>}
                </div>
              </div>

              <div className="border-t border-white/5 pt-6 space-y-3">
                <div className="flex items-center gap-2"><Printer size={16}/><div><h4 className="font-bold text-text">Formato padrao</h4><p className="text-xs text-muted">A previa permite alternar o formato sem alterar este padrao.</p></div></div>
                <div className="grid grid-cols-3 gap-3 max-w-xl">
                  {[['58', '58mm'], ['80', '80mm'], ['a4', 'A4 / PDF']].map(([format, label]) => <button key={format} type="button" disabled={!canEdit || saving} onClick={() => updateField('receipt_format', format)} className={`px-4 py-4 rounded-2xl border text-sm font-bold transition-all ${form.receipt_format === format ? 'bg-emerald-400 border-transparent text-gray-950 shadow-lg' : 'bg-white/5 border-white/5 text-muted hover:bg-white/10'}`}>{label}</button>)}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-6">
                <button type="button" className="btn btn-primary gap-2" disabled={!canEdit || saving || processingLogo || dirtyFields.size === 0} onClick={() => void save()}>{saving ? <RefreshCw size={14} className="animate-spin"/> : <Save size={14}/>} {saving ? 'Salvando...' : 'Salvar identidade e comprovantes'}</button>
                {!canEdit && <span className="text-xs text-muted">Somente administradores autorizados podem alterar estes dados.</span>}
              </div>
            </>
          )}

          {message.text && <p className={`rounded-xl border px-3 py-2 text-xs font-semibold ${message.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-red-500/20 bg-red-500/10 text-red-300'}`}>{message.text}</p>}
        </div>
      </div>
    </section>
  )
}

export default function SettingsIntegratedPage() {
  const { activeModuleId } = useModuleCtx()
  const companySettingsManaged = activeModuleId === 'petshop'
  return (
    <>
      {companySettingsManaged ? <CompanySettingsSection/> : null}
      <SettingsPage />
    </>
  )
}
