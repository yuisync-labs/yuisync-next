import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bot, CheckCircle2, FileText, RefreshCw, Save, Send, Sparkles, UploadCloud } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthCtx } from '../../context/AuthContext'
import { useModuleCtx } from '../../context/ModuleContext'

function parseTags(raw) {
  return String(raw || '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

function toDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function moduleKey(activeModule) {
  return activeModule?.id || activeModule?.key || activeModule?.module_id || 'petshop'
}

async function runEdgePlayground({ tenantId, moduleId, companyId, customerPhone, message }) {
  const response = await fetch('/api/ai-lab/playground', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-module-id': moduleId,
    },
    body: JSON.stringify({ company_id: companyId, customer_phone: customerPhone, message }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.code || 'Falha ao executar playground no Edge.')
  return payload?.data || payload
}

export default function AiLabPage() {
  const { profile, activeTenantId } = useAuthCtx()
  const { activeModule } = useModuleCtx()
  const defaultModule = moduleKey(activeModule)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })
  const [companies, setCompanies] = useState([])
  const [niches, setNiches] = useState([])
  const [selectedModuleId, setSelectedModuleId] = useState(defaultModule)
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [promptVersions, setPromptVersions] = useState([])
  const [promptDraft, setPromptDraft] = useState({ core: '', niche: '', company: '' })
  const [documents, setDocuments] = useState([])
  const [runs, setRuns] = useState([])
  const [savingLayer, setSavingLayer] = useState('')
  const [uploading, setUploading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [docForm, setDocForm] = useState({ title: '', tags: '', contentText: '', file: null })
  const [playgroundMessage, setPlaygroundMessage] = useState('')
  const [playgroundPhone, setPlaygroundPhone] = useState('+5511999999999')

  const isGlobalAdmin = profile?.role === 'admin'
  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId],
  )
  const selectedNiche = useMemo(
    () => niches.find((niche) => niche.id === selectedCompany?.niche_id) || null,
    [niches, selectedCompany?.niche_id],
  )
  const moduleOptions = useMemo(() => {
    const values = new Set(companies.map((company) => company.module_id || 'petshop'))
    if (!values.size) values.add(defaultModule)
    return [...values]
  }, [companies, defaultModule])
  const visibleCompanies = useMemo(
    () => companies.filter((company) => (company.module_id || 'petshop') === selectedModuleId),
    [companies, selectedModuleId],
  )

  const loadBase = useCallback(async () => {
    if (!activeTenantId) {
      setCompanies([])
      setNiches([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [companiesRes, nichesRes] = await Promise.all([
        supabase.from('companies')
          .select('*')
          .eq('tenant_id', activeTenantId)
          .eq('module_id', selectedModuleId || defaultModule)
          .order('created_at', { ascending: true }),
        supabase.from('niches').select('*').order('created_at', { ascending: true }),
      ])
      if (companiesRes.error) throw companiesRes.error
      if (nichesRes.error) throw nichesRes.error
      const nextCompanies = companiesRes.data || []
      setCompanies(nextCompanies)
      setNiches(nichesRes.data || [])
      setSelectedCompanyId((current) => nextCompanies.some((company) => company.id === current) ? current : (nextCompanies[0]?.id || ''))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o AI Lab.')
    } finally {
      setLoading(false)
    }
  }, [activeTenantId, defaultModule, selectedModuleId])

  const loadWorkspace = useCallback(async () => {
    if (!activeTenantId || !selectedCompany) {
      setPromptVersions([])
      setDocuments([])
      setRuns([])
      return
    }
    setRefreshing(true)
    setError('')
    try {
      const scope = { tenant: activeTenantId, module: selectedCompany.module_id || selectedModuleId || defaultModule }
      const [versionsRes, docsRes, runsRes] = await Promise.all([
        supabase.from('prompt_versions').select('*')
          .eq('tenant_id', scope.tenant).eq('module_id', scope.module).eq('company_id', selectedCompany.id)
          .order('version', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('ai_training_documents').select('*')
          .eq('tenant_id', scope.tenant).eq('module_id', scope.module).eq('company_id', selectedCompany.id)
          .order('created_at', { ascending: false }),
        supabase.from('ai_playground_runs').select('*')
          .eq('tenant_id', scope.tenant).eq('module_id', scope.module).eq('company_id', selectedCompany.id)
          .order('created_at', { ascending: false }).limit(40),
      ])
      if (versionsRes.error) throw versionsRes.error
      if (docsRes.error) throw docsRes.error
      if (runsRes.error) throw runsRes.error
      const versions = versionsRes.data || []
      const latest = {}
      for (const row of versions) if (row?.layer && latest[row.layer] == null) latest[row.layer] = row.content || ''
      setPromptVersions(versions)
      setPromptDraft({
        core: latest.core || '',
        niche: latest.niche || selectedNiche?.base_prompt || '',
        company: latest.company || selectedCompany.system_prompt || '',
      })
      setDocuments(docsRes.data || [])
      setRuns(runsRes.data || [])
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : 'Falha ao carregar o workspace.')
    } finally {
      setRefreshing(false)
    }
  }, [activeTenantId, defaultModule, selectedCompany, selectedModuleId, selectedNiche?.base_prompt])

  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { loadWorkspace() }, [loadWorkspace])
  useEffect(() => {
    if (visibleCompanies.length && !visibleCompanies.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(visibleCompanies[0].id)
    }
  }, [selectedCompanyId, visibleCompanies])

  async function savePromptLayer(layer) {
    if (!selectedCompany || !activeTenantId) return
    const content = String(promptDraft[layer] || '').trim()
    if (!content) return setError(`A camada ${layer} nao pode ficar vazia.`)
    setSavingLayer(layer)
    setError('')
    setMessage({ type: '', text: '' })
    try {
      const nextVersion = Math.max(0, ...promptVersions.filter((row) => row.layer === layer).map((row) => Number(row.version || 0))) + 1
      const moduleId = selectedCompany.module_id || selectedModuleId || defaultModule
      const insert = await supabase.from('prompt_versions').insert({
        tenant_id: activeTenantId,
        module_id: moduleId,
        company_id: selectedCompany.id,
        layer,
        content,
        version: nextVersion,
        is_active: true,
        changed_by: profile?.id || null,
        change_note: 'Atualizacao via AI Lab Cloudflare',
      })
      if (insert.error) throw insert.error
      if (layer === 'company') {
        const update = await supabase.from('companies').update({ system_prompt: content })
          .eq('tenant_id', activeTenantId).eq('module_id', moduleId).eq('id', selectedCompany.id)
        if (update.error) throw update.error
      }
      if (layer === 'niche' && selectedNiche?.id) {
        const update = await supabase.from('niches').update({ base_prompt: content }).eq('id', selectedNiche.id)
        if (update.error) throw update.error
      }
      setMessage({ type: 'success', text: `Camada ${layer} salva no Edge.` })
      await loadBase()
      await loadWorkspace()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar prompt.')
    } finally {
      setSavingLayer('')
    }
  }

  async function uploadDocument() {
    if (!selectedCompany || !activeTenantId) return
    setUploading(true)
    setError('')
    setMessage({ type: '', text: '' })
    try {
      let contentText = String(docForm.contentText || '').trim()
      let mimeType = null
      let fileSize = null
      if (docForm.file) {
        mimeType = docForm.file.type || 'text/plain'
        fileSize = Number(docForm.file.size || 0)
        const textLike = mimeType.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(docForm.file.name)
        if (!textLike) throw new Error('Neste cutover Cloudflare, documentos binarios devem ser convertidos para TXT, MD, CSV ou JSON antes do envio.')
        if (!contentText) contentText = (await docForm.file.text()).slice(0, 120000)
      }
      if (!contentText) throw new Error('Informe um texto ou selecione um arquivo textual.')
      const moduleId = selectedCompany.module_id || selectedModuleId || defaultModule
      const insert = await supabase.from('ai_training_documents').insert({
        tenant_id: activeTenantId,
        module_id: moduleId,
        company_id: selectedCompany.id,
        title: String(docForm.title || '').trim() || docForm.file?.name || 'Documento de treino',
        mime_type: mimeType,
        file_size: fileSize,
        content_text: contentText,
        tags: parseTags(docForm.tags),
        status: 'active',
        uploaded_by: profile?.id || null,
      })
      if (insert.error) throw insert.error
      setDocForm({ title: '', tags: '', contentText: '', file: null })
      setMessage({ type: 'success', text: 'Documento persistido no D1 e disponivel para o playground.' })
      await loadWorkspace()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Falha ao enviar documento.')
    } finally {
      setUploading(false)
    }
  }

  async function archiveDocument(documentId) {
    if (!selectedCompany || !activeTenantId || !documentId) return
    const moduleId = selectedCompany.module_id || selectedModuleId || defaultModule
    const result = await supabase.from('ai_training_documents').update({ status: 'archived' })
      .eq('tenant_id', activeTenantId).eq('module_id', moduleId).eq('id', documentId)
    if (result.error) setError(result.error.message)
    else await loadWorkspace()
  }

  async function runPlayground() {
    if (!selectedCompany || !activeTenantId || !playgroundMessage.trim()) return
    setTesting(true)
    setError('')
    setMessage({ type: '', text: '' })
    try {
      const moduleId = selectedCompany.module_id || selectedModuleId || defaultModule
      const run = await runEdgePlayground({
        tenantId: activeTenantId,
        moduleId,
        companyId: selectedCompany.id,
        customerPhone: playgroundPhone,
        message: playgroundMessage.trim(),
      })
      setRuns((current) => [{
        id: run.id || `edge-${Date.now()}`,
        input_message: playgroundMessage.trim(),
        action: run.action || 'preview',
        reply: run.reply || '',
        parsed_intent: run.intent || null,
        created_at: run.created_at || new Date().toISOString(),
      }, ...current].slice(0, 40))
      setPlaygroundMessage('')
      setMessage({ type: 'success', text: 'Playground executado no Cloudflare Edge sem efeitos operacionais.' })
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Falha ao testar a IA.')
    } finally {
      setTesting(false)
    }
  }

  if (!isGlobalAdmin) return <div className="page max-w-4xl mx-auto"><div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-200">Esta area e exclusiva para Admin Global.</div></div>
  if (!activeTenantId) return <div className="page max-w-4xl mx-auto"><div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-200">Selecione uma instancia ativa para abrir o AI Lab.</div></div>
  if (loading) return <div className="page flex items-center justify-center py-20 text-muted"><RefreshCw size={18} className="animate-spin mr-2" />Carregando AI Lab...</div>

  return (
    <div className="page animate-fade-up max-w-7xl mx-auto pb-20 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2"><Sparkles size={22} />Treino de IA</h1>
          <p className="page-sub">Prompts, conhecimento e playground agora persistidos e executados pelo Cloudflare Edge.</p>
        </div>
        <button onClick={loadWorkspace} className="btn btn-secondary gap-2"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Atualizar</button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex gap-2"><AlertCircle size={15} />{error}</div>}
      {message.text && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 flex gap-2"><CheckCircle2 size={15} />{message.text}</div>}

      <section className="bg-card border border-white/10 rounded-3xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label className="inp-label">Modulo</label><select className="inp" value={selectedModuleId} onChange={(event) => setSelectedModuleId(event.target.value)}>{moduleOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        <div><label className="inp-label">Bot</label><select className="inp" value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}><option value="">Selecione</option>{visibleCompanies.map((company) => <option key={company.id} value={company.id}>{company.bot_name || company.name}</option>)}</select></div>
      </section>

      {!selectedCompany && <div className="rounded-2xl border border-white/10 p-6 text-muted">Nenhuma empresa de IA migrada para este tenant/modulo.</div>}

      {selectedCompany && <>
        <section className="bg-card border border-white/10 rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold"><Bot size={16} />{selectedCompany.bot_name || selectedCompany.name} · {selectedCompany.model_name || 'gpt-4o-mini'}</div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {['core', 'niche', 'company'].map((layer) => <div key={layer} className="rounded-2xl border border-white/10 p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-wider text-muted">{layer}</p>
              <textarea className="inp min-h-[220px] resize-y" value={promptDraft[layer] || ''} onChange={(event) => setPromptDraft((current) => ({ ...current, [layer]: event.target.value }))} />
              <button onClick={() => savePromptLayer(layer)} disabled={savingLayer === layer} className="btn btn-primary w-full gap-2">{savingLayer === layer ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}Salvar</button>
            </div>)}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-card border border-white/10 rounded-3xl p-5 space-y-4">
            <p className="text-xs font-black uppercase tracking-wider text-muted flex items-center gap-2"><FileText size={14} />Conhecimento D1</p>
            <input className="inp" placeholder="Titulo" value={docForm.title} onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))} />
            <input className="inp" placeholder="tags, separadas, por virgula" value={docForm.tags} onChange={(event) => setDocForm((current) => ({ ...current, tags: event.target.value }))} />
            <textarea className="inp min-h-[130px]" placeholder="Conteudo textual" value={docForm.contentText} onChange={(event) => setDocForm((current) => ({ ...current, contentText: event.target.value }))} />
            <input type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" onChange={(event) => setDocForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} className="block w-full text-sm text-muted" />
            <button onClick={uploadDocument} disabled={uploading} className="btn btn-primary w-full gap-2"><UploadCloud size={14} />{uploading ? 'Enviando...' : 'Adicionar conhecimento'}</button>
            <div className="space-y-2 max-h-[320px] overflow-auto">{documents.map((doc) => <div key={doc.id} className="rounded-xl border border-white/10 p-3 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{doc.title}</p><p className="text-xs text-muted">{doc.status} · {toDateTime(doc.created_at)}</p></div>{doc.status !== 'archived' && <button className="btn btn-secondary text-xs" onClick={() => archiveDocument(doc.id)}>Arquivar</button>}</div>)}</div>
          </div>

          <div className="bg-card border border-white/10 rounded-3xl p-5 space-y-4">
            <p className="text-xs font-black uppercase tracking-wider text-muted flex items-center gap-2"><Sparkles size={14} />Playground Edge</p>
            <input className="inp" value={playgroundPhone} onChange={(event) => setPlaygroundPhone(event.target.value)} placeholder="Telefone de teste" />
            <textarea className="inp min-h-[130px]" value={playgroundMessage} onChange={(event) => setPlaygroundMessage(event.target.value)} placeholder="Mensagem para testar o bot" />
            <button onClick={runPlayground} disabled={testing || !playgroundMessage.trim()} className="btn btn-primary w-full gap-2"><Send size={14} />{testing ? 'Executando...' : 'Testar no Edge'}</button>
            <div className="space-y-2 max-h-[380px] overflow-auto">{runs.map((run) => <div key={run.id} className="rounded-xl border border-white/10 p-3 space-y-2"><p className="text-xs text-muted">{toDateTime(run.created_at)} · {run.action || 'preview'}</p><p className="text-sm"><strong>Entrada:</strong> {run.input_message}</p><p className="text-sm whitespace-pre-wrap"><strong>Resposta:</strong> {run.reply || '-'}</p></div>)}</div>
          </div>
        </section>
      </>}
    </div>
  )
}
