import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift, Plus, RefreshCw, Save, ShieldAlert, Star, Trophy, X } from 'lucide-react'
import { usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import { useClients } from '../../../shared/hooks/useClients'

const LOYALTY_GUIDE = [
  'Cada compra ou servico pode gerar pontos para o tutor.',
  'O saldo fica acumulado por cliente/pet e pode ser usado em resgates.',
  'Lancamentos manuais ajudam em bonus, campanha ou ajustes de atendimento.',
  'A configuracao define quantos pontos entram e quantos valem R$ 1.',
]

const LOYALTY_CHECKLIST = [
  'Salvar a configuracao de pontos e recarregar a tela.',
  'Lancar pontos manualmente para um cliente de teste.',
  'Conferir se o saldo aparece no quadro principal.',
  'Registrar uma venda e validar se a movimentacao entra na lista recente.',
]

function PointsModal({ clients, onClose, onSave }) {
  const [form, setForm] = useState({
    pet_id: clients[0]?.id || '',
    points: 20,
    reason: 'bonus',
    expires_at: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setSaving(true)
    setError('')
    try {
      const selectedPet = clients.find((client) => String(client.id) === String(form.pet_id))
      await onSave({
        ...form,
        client_id: selectedPet?.tutor_group_id || selectedPet?.id || '',
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box max-w-lg">
        <div className="modal-header">
          <h2 className="font-display font-bold text-xl text-text">Lancamento Manual</h2>
          <button onClick={onClose} className="text-muted hover:text-text"><X size={18} /></button>
        </div>

        <div className="modal-body space-y-4">
          <div>
            <label className="inp-label">Pet / Tutor</label>
            <select className="inp" value={form.pet_id} onChange={(event) => setForm((prev) => ({ ...prev, pet_id: event.target.value }))}>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.pet_name || client.owner_name} - {client.owner_name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="inp-label">Pontos</label>
              <input className="inp" type="number" value={form.points} onChange={(event) => setForm((prev) => ({ ...prev, points: Number(event.target.value) }))} />
            </div>
            <div>
              <label className="inp-label">Motivo</label>
              <select className="inp" value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}>
                <option value="bonus">Bonus</option>
                <option value="compra">Compra</option>
                <option value="resgate">Resgate</option>
                <option value="campanha">Campanha</option>
              </select>
            </div>
          </div>

          <div>
            <label className="inp-label">Validade (opcional)</label>
            <input className="inp" type="date" value={form.expires_at} onChange={(event) => setForm((prev) => ({ ...prev, expires_at: event.target.value }))} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={handleSubmit} disabled={saving} className="btn btn-primary flex-1 justify-center">
              {saving ? 'Salvando...' : 'Lancar Pontos'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function FidelidadePage() {
  const { loadLoyaltyDashboard, saveLoyaltySettings, createLoyaltyEntry } = usePetshopAdvanced()
  const { clients, load: loadClients } = useClients()
  const [settings, setSettings] = useState(null)
  const [balances, setBalances] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPointsModal, setShowPointsModal] = useState(false)

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const dashboard = await loadLoyaltyDashboard()
      setSettings(dashboard.settings)
      setBalances(dashboard.balances)
      setRecent(dashboard.recent)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClients()
    reload()
  }, [])

  async function handleSaveSettings() {
    setSaving(true)
    setError('')
    try {
      await saveLoyaltySettings(settings)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateEntry(payload) {
    await createLoyaltyEntry(payload)
    await reload()
  }

  const totalPoints = balances.reduce((sum, entry) => sum + Number(entry.balance || 0), 0)

  return (
    <div className="page animate-fade-up space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Trophy size={22} className="text-amber-400" />
            Fidelidade
          </h1>
          <p className="page-sub">Pontuacao automatica nas vendas e saldo por tutor.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => reload()} className="btn btn-secondary">
            <RefreshCw size={15} /> Atualizar
          </button>
          <button onClick={() => setShowPointsModal(true)} className="btn btn-primary">
            <Plus size={15} /> Lancar pontos
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-5">
          <p className="text-sm font-semibold text-text">Como esta aba funciona</p>
          <div className="grid grid-cols-1 gap-3 mt-4">
            {LOYALTY_GUIDE.map((item) => (
              <div key={item} className="rounded-xl border border-white/10 bg-white/40 px-4 py-3 text-sm text-text">
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-5">
          <p className="text-sm font-semibold text-text">Checklist rapido de testes</p>
          <div className="grid grid-cols-1 gap-3 mt-4">
            {LOYALTY_CHECKLIST.map((item) => (
              <div key={item} className="rounded-xl border border-white/10 bg-white/40 px-4 py-3 text-sm text-text">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Clientes com saldo</p>
          <p className="font-display font-bold text-3xl text-text">{balances.length}</p>
        </div>
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Pontos em circulacao</p>
          <p className="font-display font-bold text-3xl text-amber-400">{totalPoints}</p>
        </div>
        <div className="bg-card border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-bold mb-2">Fator de resgate</p>
          <p className="font-display font-bold text-3xl text-emerald-400">
            {settings ? `${settings.redemption_rate} pts` : '--'}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm rounded-xl px-4 py-3 bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-2">
          <ShieldAlert size={14} /> {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <div className="bg-card border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Gift size={16} className="text-emerald-400" />
            <h2 className="section-title">Configuracao</h2>
          </div>

          {settings && (
            <>
              <div>
                <label className="inp-label">Pontos por real</label>
                <input className="inp" type="number" step="0.1" value={settings.points_per_real} onChange={(event) => setSettings((prev) => ({ ...prev, points_per_real: event.target.value }))} />
              </div>
              <div>
                <label className="inp-label">Bonus por servico</label>
                <input className="inp" type="number" value={settings.points_per_service} onChange={(event) => setSettings((prev) => ({ ...prev, points_per_service: event.target.value }))} />
              </div>
              <div>
                <label className="inp-label">Pontos para resgatar R$ 1</label>
                <input className="inp" type="number" value={settings.redemption_rate} onChange={(event) => setSettings((prev) => ({ ...prev, redemption_rate: event.target.value }))} />
              </div>
              <div>
                <label className="inp-label">Validade em dias</label>
                <input className="inp" type="number" value={settings.expiry_days} onChange={(event) => setSettings((prev) => ({ ...prev, expiry_days: event.target.value }))} />
              </div>
              <button onClick={handleSaveSettings} disabled={saving} className="btn btn-primary w-full justify-center">
                <Save size={15} /> {saving ? 'Salvando...' : 'Salvar configuracao'}
              </button>
            </>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border2)] flex items-center gap-2">
              <Star size={16} className="text-amber-400" />
              <h2 className="section-title">Saldo atual</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Tutor</th>
                    <th>Telefone</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((entry) => (
                    <tr key={entry.client_id}>
                      <td>
                        <p className="font-semibold text-text">{entry.client.owner_name || 'Tutor não identificado'}</p>
                      </td>
                      <td>{entry.client.phone || '-'}</td>
                      <td className="font-bold text-amber-400">{entry.balance} pts</td>
                    </tr>
                  ))}
                  {!balances.length && !loading && (
                    <tr>
                      <td colSpan={3} className="text-center text-muted py-10">Nenhum saldo registrado ainda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-card border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border2)]">
              <h2 className="section-title">Ultimos lancamentos</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Motivo</th>
                    <th>Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.created_at).toLocaleDateString('pt-BR')}</td>
                      <td>{entry.client.pet_name || entry.client.owner_name}</td>
                      <td className="capitalize">{entry.reason}</td>
                      <td className={Number(entry.points) >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                        {Number(entry.points) >= 0 ? '+' : ''}{entry.points}
                      </td>
                    </tr>
                  ))}
                  {!recent.length && !loading && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted py-10">Sem movimentacoes por enquanto.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showPointsModal && (
        <PointsModal
          clients={clients}
          onClose={() => setShowPointsModal(false)}
          onSave={handleCreateEntry}
        />
      )}
    </div>
  )
}
